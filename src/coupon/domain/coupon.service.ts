import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { COUPON_REPOSITORY, CouponRepository } from './coupon.repository';

import {
    TRANSACTION_MANAGER,
    TransactionClient,
    TransactionManager,
} from '../../common/transaction/transaction-client';

import {
    AvailableCouponResponseDto,
    UserCouponResponseDto,
    UserCouponToUseResponseDto,
} from '../presentation/dto/coupon.response.dto';

import { CouponType } from '../../common/status';
import { getCurrentDate, getUpcomingDate } from '../../common/util/date';
import { ErrorMessage } from '../../common/errorStatus';
import { CouponRedisRepository } from '../infrastructure/coupon.redis.repository';
import {
    generateCouponKey,
    generateIssueCouponKey,
    generateRequestIssueCouponKey,
} from '../../common/util/generateRedisKey';
import { CouponRedisKey } from '../../common/redisKey';

@Injectable()
export class CouponService {
    constructor(
        @Inject(COUPON_REPOSITORY) private readonly couponRepository: CouponRepository,
        @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
        private readonly couponRedisRepository: CouponRedisRepository,
    ) {}

    async getAvailableCoupons(userId: number): Promise<AvailableCouponResponseDto[]> {
        // 유저가 보유한 쿠폰 ids
        const userCouponIds = await this.couponRepository.getUserOwnedCouponIds(userId);
        const couponIds = userCouponIds.map((userCouponId) => userCouponId.couponId);

        const currentDate = getCurrentDate();

        // 발급 가능 쿠폰
        const coupons = await this.couponRepository.getAvailableCoupons(couponIds, currentDate);
        return coupons.map((coupon) => AvailableCouponResponseDto.from(coupon));
    }

    async issueCoupon(couponId: number, userId: number): Promise<UserCouponResponseDto> {
        const currentDate = getCurrentDate();

        // 유효 쿠폰: 발급 가능 상태, 사용기간이 지나지 않은 쿠폰, 발급 이력 없는 쿠폰
        const isCouponValid = await this.couponRepository.couponValidCheck(
            couponId,
            userId,
            currentDate,
        );
        if (!isCouponValid) {
            throw new BadRequestException(ErrorMessage.COUPON_INVALID);
        }

        return await this.transactionManager.transaction(async (tx) => {
            // 쿠폰 재고 확인(비관적 락)
            const couponQuantity = await this.couponRepository.couponQuantityValidCheckWithLock(
                couponId,
                tx,
            );
            if (!couponQuantity) {
                throw new BadRequestException(ErrorMessage.COUPON_QUANTITY_EXCEEDED);
            }

            //유저 쿠폰 지급
            const userCoupon = await this.couponRepository.insertUserCoupon(couponId, userId, tx);

            //쿠폰 재고 차감
            await this.couponRepository.decrementCouponQuantity(couponId, tx);

            return UserCouponResponseDto.from(userCoupon);
        });
    }

    async issueCouponWithRedLock(couponId: number, userId: number): Promise<UserCouponResponseDto> {
        const currentDate = getCurrentDate();

        let lock;

        try {
            const retryCount = 10;
            const retryDelay = 300;
            await this.couponRedisRepository.initRedLock(retryCount, retryDelay);

            const lockDuration = 5000;
            lock = await this.couponRedisRepository.acquireCouponIssueLock(
                `issueCoupon:${couponId}`,
                lockDuration,
            );

            const isCouponValid = await this.couponRepository.couponValidCheck(
                couponId,
                userId,
                currentDate,
            );
            if (!isCouponValid) {
                throw new BadRequestException(ErrorMessage.COUPON_INVALID);
            }

            return await this.transactionManager.transaction(async (tx) => {
                const couponQuantity = await this.couponRepository.couponQuantityValidCheck(
                    couponId,
                    tx,
                );
                if (!couponQuantity) {
                    throw new BadRequestException(ErrorMessage.COUPON_QUANTITY_EXCEEDED);
                }

                //유저 쿠폰 지급
                const userCoupon = await this.couponRepository.insertUserCoupon(
                    couponId,
                    userId,
                    tx,
                );

                //쿠폰 재고 차감
                await this.couponRepository.decrementCouponQuantity(couponId, tx);

                return UserCouponResponseDto.from(userCoupon);
            });
        } catch (err) {
            throw err;
        } finally {
            await this.couponRedisRepository.releaseCouponIssueLock(lock);
        }
    }

    //레디스 자료구조를 이용한 선착순 쿠폰 발급 요청 큐 저장
    async issueCouponRequestEnqueue(couponId: number, userId: number) {
        const issueKey = generateIssueCouponKey(couponId);
        const member = String(userId);

        //지급 이력 중복 체크
        const isDuplicate = await this.couponRedisRepository.sismemberIssueCoupon(issueKey, member);
        if (isDuplicate) {
            throw new BadRequestException(ErrorMessage.COUPON_ISSUE_DUPLICATED);
        }

        const couponKey = generateCouponKey(couponId);

        let redisCouponStock: number | null;
        redisCouponStock = await this.couponRedisRepository.getCouponStock(couponKey);

        //쿠폰 재고 캐시 워밍으로 처리로 인해 해당 조건내 로직 발생 가능성 적음
        if (redisCouponStock === null) {
            const couponStock = await this.couponRepository.getCouponStock(couponId);
            if (couponStock <= 0) {
                throw new BadRequestException(ErrorMessage.COUPON_QUANTITY_EXCEEDED);
            }
            await this.couponRedisRepository.setCouponStock(couponKey, couponStock);
            redisCouponStock = await this.couponRedisRepository.getCouponStock(couponKey);
        }

        // 쿠폰 잔여 수량 확인
        if (redisCouponStock <= 0) {
            throw new BadRequestException(ErrorMessage.COUPON_QUANTITY_EXCEEDED);
        }

        const score = Date.now();
        const requestQueueKey = generateRequestIssueCouponKey(couponId);

        //요청 대기열 데이터 추가
        const zaddRequestQueue = await this.couponRedisRepository.zaddCouponRequest(
            requestQueueKey,
            score,
            member,
        );
        if (zaddRequestQueue === 0) {
            throw new BadRequestException(ErrorMessage.COUPON_REQUEST_DUPLICATED);
        }

        return '쿠폰 발급 요청에 성공하였습니다.';
    }

    // 선착순 쿠폰 발급 큐 제거 및 발급 실행
    async issueCouponRequestDequeue(couponId: number) {
        try {
            // 쿠폰 수량 조회
            const couponKey = generateCouponKey(couponId);
            const couponStock = await this.couponRedisRepository.getCouponStock(couponKey);
            if (!couponStock) {
                throw new Error(ErrorMessage.COUPON_ISSUE_DUPLICATED);
            }

            //남은 수량 만큼 대기열 빼기
            const requestQueueKey = generateRequestIssueCouponKey(couponId);
            const requestQueue = await this.couponRedisRepository.zpopminCouponRequest(
                requestQueueKey,
                couponStock,
            );

            const successIssue = [];

            //TODO: 실패 재처리 로직 구현
            const failedIssue = [];

            await Promise.allSettled(
                requestQueue.map(async (request) => {
                    const userId = request;

                    const issueKey = generateIssueCouponKey(couponId);
                    const saddCouponIssue = await this.couponRedisRepository.saddIssueCoupon(
                        issueKey,
                        userId,
                    );

                    if (saddCouponIssue <= 0) {
                        failedIssue.push({ issueKey, userId });
                        return;
                    }

                    await this.issueCouponWithRedisStructure(couponId, Number(userId));
                    successIssue.push(userId);
                }),
            );

            const updateCouponStock = couponStock - successIssue.length;
            await this.couponRedisRepository.updateCouponStock(couponKey, updateCouponStock);
        } catch (err) {
            throw new Error(err.message);
        }
    }

    // 스케줄러를 이용한 쿠폰 발급
    async issueCouponWithRedisStructure(couponId: number, userId: number) {
        const currentDate = getCurrentDate();

        // 유효 쿠폰: 발급 가능 상태, 사용기간이 지나지 않은 쿠폰, 발급 이력 없는 쿠폰
        const isCouponValid = await this.couponRepository.couponValidCheck(
            couponId,
            userId,
            currentDate,
        );
        if (!isCouponValid) {
            throw new BadRequestException(ErrorMessage.COUPON_INVALID);
        }

        return await this.transactionManager.transaction(async (tx) => {
            //유저 쿠폰 지급
            await this.couponRepository.insertUserCoupon(couponId, userId, tx);

            //쿠폰 재고 차감
            await this.couponRepository.decrementCouponQuantity(couponId, tx);
        });
    }

    // 선착순 쿠폰 레디스 재고 로드
    async couponStockLoadInRedis(): Promise<{ couponId: number; stock: number }[]> {
        const couponOpenDate = getUpcomingDate(1);

        let loadCouponList: { couponId: number; stock: number }[] = [];

        const upcomingCouponList =
            await this.couponRepository.getUpcomingCouponList(couponOpenDate);

        if (upcomingCouponList.length <= 0) {
            return;
        }

        for (const coupon of upcomingCouponList) {
            const { couponId, stock } = coupon;
            const couponKey = generateCouponKey(couponId);

            const existCouponStock = await this.couponRedisRepository.getCouponStock(couponKey);
            if (existCouponStock) {
                continue;
            }

            await this.couponRedisRepository.setCouponStock(couponKey, stock);
            loadCouponList.push({ couponId, stock });
        }

        return loadCouponList;
    }

    // 선착순 쿠폰 로드된 정보 조회
    async getLoadCouponList(): Promise<Map<string, number>> {
        const couponLoadList = await this.couponRedisRepository.getCouponStockLoadList(
            CouponRedisKey.COUPON,
        );

        const loadCouponMap = new Map<string, number>();

        if (couponLoadList.length <= 0) {
            return loadCouponMap;
        }

        for (const loadCoupon of couponLoadList) {
            const couponId = loadCoupon.split(':')[1];
            const couponKey = generateCouponKey(Number(couponId));

            const stock = await this.couponRedisRepository.getCouponStock(couponKey);
            loadCouponMap.set(couponId, stock);
        }

        return loadCouponMap;
    }

    async getUserCoupons(
        userId: number,
        take: number,
        skip: number,
    ): Promise<UserCouponResponseDto[]> {
        const userCoupons = await this.couponRepository.getUserOwnedCoupons(userId, take, skip);
        return userCoupons.map((userCoupon) => UserCouponResponseDto.from(userCoupon));
    }

    async getUserCouponToUseWithLock(
        userCouponId: number,
        userId: number,
        tx?: TransactionClient,
    ): Promise<UserCouponToUseResponseDto> {
        const userCoupon = await this.couponRepository.findByUserCouponIdWithLock(
            userCouponId,
            userId,
            tx,
        );

        if (!userCoupon) {
            throw new BadRequestException(ErrorMessage.COUPON_NOT_FOUND);
        }

        return UserCouponToUseResponseDto.from(userCoupon);
    }

    async getUserCouponToUse(
        userCouponId: number,
        userId: number,
        tx?: TransactionClient,
    ): Promise<UserCouponToUseResponseDto> {
        const userCoupon = await this.couponRepository.findByUserCouponId(userCouponId, userId, tx);

        if (!userCoupon) {
            throw new BadRequestException(ErrorMessage.COUPON_NOT_FOUND);
        }

        return UserCouponToUseResponseDto.from(userCoupon);
    }

    validateAndCalculateDiscountAmount(
        userCoupon: UserCouponToUseResponseDto,
        totalAmount: number,
    ) {
        const { discountType, discountValue } = userCoupon;

        if (!discountType || !discountValue) {
            throw new BadRequestException(ErrorMessage.COUPON_INVALID);
        }

        let discountAmount = 0;

        if (discountType === CouponType.PRICE) {
            discountAmount = discountValue;
        } else if (discountType === CouponType.PERCENT) {
            discountAmount = Math.round(totalAmount * (discountValue / 100));
        }

        return discountAmount;
    }

    async useCoupon(userCouponId: number, userId: number, tx?: TransactionClient): Promise<void> {
        return await this.couponRepository.updateCouponStatus(userCouponId, userId, tx);
    }
}
