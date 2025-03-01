import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { OrderRequestDto } from '../presentation/dto/order.request.dto';
import { OrderResponseDto } from '../presentation/dto/order.response.dto';
import { CreateOrderDto } from '../domain/dto/create.order.dto';
import { CreateOrderItemDto } from '../domain/dto/create.order-item.dto';

import { UserService } from '../../user/domain/user.service';
import { OrderService } from '../domain/order.service';
import { ProductService } from '../../product/domain/product.service';
import { CouponService } from '../../coupon/domain/coupon.service';

import {
    TRANSACTION_MANAGER,
    TransactionManager,
} from '../../common/transaction/transaction-client';

import { OrderStatus } from '../../common/status';
import { ErrorMessage } from '../../common/errorStatus';
import { RedlockService } from '../../database/redis/redlock.service';
import { LoggerService } from '../../common/logger/logger.service';

@Injectable()
export class OrderFacade {
    constructor(
        private readonly orderService: OrderService,
        private readonly userService: UserService,
        private readonly productService: ProductService,
        private readonly couponService: CouponService,
        private readonly redlockService: RedlockService,
        private readonly loggerService: LoggerService,
        @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
    ) {}

    async order(orderRequestDto: OrderRequestDto) {
        const { userId, couponId = null, products } = orderRequestDto;

        return await this.transactionManager.transaction(async (tx) => {
            // 주문 가능 상품 조회
            const productsInfo = await this.productService.getAvailableOrderProducts(products, tx);

            await Promise.all(
                productsInfo.map(async (item) => {
                    const productInfo = products.find((product) => product.productId === item.id);
                    await this.productService.validateProductRemainingQuantityWithLock(
                        item.id,
                        productInfo.quantity,
                        tx,
                    );
                    await this.productService.decreaseProductRemainingQuantity(
                        item.id,
                        productInfo.quantity,
                        tx,
                    );
                }),
            );

            // 유저 조회
            const user = await this.userService.getUserBalance(userId, tx);

            //주문 수량에 맞는 가격 산출
            const orderProductsPriceInfo = await this.productService.calculateQuantityProductPrice(
                products,
                productsInfo,
            );

            //주문 상품 총 금액 산출
            const totalAmount = orderProductsPriceInfo.reduce((acc, curr) => {
                return acc + curr.totalPrice;
            }, 0);

            let discountAmount = 0;
            let finalAmount = totalAmount;

            if (couponId && couponId > 0) {
                const userCoupon = await this.couponService.getUserCouponToUseWithLock(
                    couponId,
                    userId,
                    tx,
                );

                // 쿠폰 검증 & 할인가 산출
                discountAmount = this.couponService.validateAndCalculateDiscountAmount(
                    userCoupon,
                    totalAmount,
                );
                finalAmount -= discountAmount;

                // 쿠폰 사용 처리
                await this.couponService.useCoupon(couponId, userId, tx);
            }

            const userBalance = user.balance;
            if (userBalance < finalAmount) {
                throw new BadRequestException(ErrorMessage.USER_BALANCE_NOT_ENOUGH);
            }

            const orderObj = {
                userId,
                couponId,
                totalAmount,
                discountAmount,
                finalAmount,
                status: OrderStatus.PENDING,
            };

            // 주문 정보 데이터 생성
            const order = await this.orderService.createOrder(CreateOrderDto.from(orderObj), tx);

            const orderItemsDto = orderProductsPriceInfo.map((orderProduct) =>
                CreateOrderItemDto.from({
                    ...orderProduct,
                    orderId: order.id,
                }),
            );

            const orderResponseData = {
                ...order,
                orderItems: [],
            };

            // 주문 상품 정보 데이터 생성
            orderResponseData.orderItems = await Promise.all(
                orderItemsDto.map(
                    async (item) => await this.orderService.createOrderItem(item, tx),
                ),
            );

            return OrderResponseDto.from(orderResponseData);
        });
    }

    async orderWithRedLock(orderRequestDto: OrderRequestDto) {
        const { userId, couponId = null, products } = orderRequestDto;

        const lockDuration = 5000;

        let locks = [];

        try {
            const retryCount = 10;
            const retryDelay = 300;
            await this.redlockService.setRedLock(retryCount, retryDelay);

            for (const product of products) {
                const key = `order:${product.productId}`;
                const lock = await this.redlockService.acquireLock(key, lockDuration);
                locks.push(lock);
            }

            return await this.transactionManager.transaction(async (tx) => {
                // 주문 가능 상품 조회
                const productsInfo = await this.productService.getAvailableOrderProducts(
                    products,
                    tx,
                );

                for (let item of productsInfo) {
                    const productInfo = products.find((product) => product.productId === item.id);

                    //주문 상품 재고 검증
                    await this.productService.validateProductRemainingQuantity(
                        item.id,
                        productInfo.quantity,
                        tx,
                    );

                    //주문 상품 재고 차감
                    await this.productService.decreaseProductRemainingQuantity(
                        item.id,
                        productInfo.quantity,
                        tx,
                    );
                }

                // 유저 조회
                const user = await this.userService.getUserBalance(userId, tx);

                //주문 수량에 맞는 가격 산출
                const orderProductsPriceInfo =
                    await this.productService.calculateQuantityProductPrice(products, productsInfo);

                //주문 상품 총 금액 산출
                const totalAmount = orderProductsPriceInfo.reduce((acc, curr) => {
                    return acc + curr.totalPrice;
                }, 0);

                let discountAmount = 0;
                let finalAmount = totalAmount;

                if (couponId && couponId > 0) {
                    const userCoupon = await this.couponService.getUserCouponToUseWithLock(
                        couponId,
                        userId,
                        tx,
                    );

                    // 쿠폰 검증 & 할인가 산출
                    discountAmount = this.couponService.validateAndCalculateDiscountAmount(
                        userCoupon,
                        totalAmount,
                    );
                    finalAmount -= discountAmount;

                    // 쿠폰 사용 처리
                    await this.couponService.useCoupon(couponId, userId, tx);
                }

                const userBalance = user.balance;
                if (userBalance < finalAmount) {
                    throw new BadRequestException(ErrorMessage.USER_BALANCE_NOT_ENOUGH);
                }

                const orderObj = {
                    userId,
                    couponId,
                    totalAmount,
                    discountAmount,
                    finalAmount,
                    status: OrderStatus.PENDING,
                };

                // 주문 정보 데이터 생성
                const order = await this.orderService.createOrder(
                    CreateOrderDto.from(orderObj),
                    tx,
                );

                const orderItemsDto = orderProductsPriceInfo.map((orderProduct) =>
                    CreateOrderItemDto.from({
                        ...orderProduct,
                        orderId: order.id,
                    }),
                );

                const orderResponseData = {
                    ...order,
                    orderItems: [],
                };

                // 주문 상품 정보 데이터 생성
                for (let item of orderItemsDto) {
                    const orderItem = await this.orderService.createOrderItem(item, tx);
                    orderResponseData.orderItems.push(orderItem);
                }

                return OrderResponseDto.from(orderResponseData);
            });
        } catch (err) {
            throw err;
        } finally {
            for (const lock of locks) {
                await this.redlockService.releaseLock(lock);
            }
        }
    }
}
