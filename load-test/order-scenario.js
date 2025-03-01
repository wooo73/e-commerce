import http from 'k6/http';
import { check } from 'k6';

/**
 * 주문 시나리오
 * 1. 포인트 충전
 * 2. 주문 요청
 * 3. 결제 요청
 */

export let options = {
    scenarios: {
        contacts: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '10s', target: 100 },
                { duration: '20s', target: 250 },
                { duration: '10s', target: 150 },
                { duration: '20s', target: 50 },
                { duration: '10s', target: 0 },
            ],
        },
    },
};

export default function () {
    const userId = Math.floor(Math.random() * 10000) + 1;
    const amount = 10000;

    const headers = { 'Content-Type': 'application/json' };

    pointCharge(userId, amount, headers);

    const productIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const quantities = [1, 2, 3];

    const products = [
        {
            productId: productIds[Math.floor(Math.random() * productIds.length)],
            quantity: quantities[Math.floor(Math.random() * quantities.length)],
        },
    ];

    const orderRes = orderWithOutCoupon(userId, products, null, headers);

    const orderData = JSON.parse(orderRes);

    payment(userId, orderData.id, headers);
}

const BASE_URL = 'http://localhost:3030';

function pointCharge(userId, amount, headers) {
    const params = {
        headers,
        tags: { name: 'pointCharge' },
    };

    const payload = JSON.stringify({
        amount: amount,
    });

    const response = http.post(`${BASE_URL}/user/${userId}/balance/charge`, payload, params);

    const checkResult = check(response, {
        '상태 코드 정상': (r) => r.status === 201,
    });

    if (!checkResult) {
        console.error(
            `포인트 충전 오류: UserID ${userId}, 상태 코드: ${response.status}, 응답: ${response.body}`,
        );
    }
}

function orderWithOutCoupon(userId, products, couponId, headers) {
    const params = {
        headers,
        tags: { name: 'orderWithOutCoupon' },
    };

    const payload = JSON.stringify({
        userId,
        products,
        couponId,
    });

    const response = http.post(`${BASE_URL}/order`, payload, params);

    const checkResult = check(response, {
        '상태 코드 정상': (r) => r.status === 201,
    });

    if (!checkResult) {
        console.error(
            `주문 요청 오류: UserID ${userId}, 상태 코드: ${response.status}, 응답: ${response.body}`,
        );
    }

    return response.body;
}

function payment(userId, orderId, headers) {
    const params = {
        headers,
        tags: { name: 'payment' },
    };

    const payload = JSON.stringify({
        orderId,
        userId,
    });

    const response = http.post(`${BASE_URL}/payment`, payload, params);

    const checkResult = check(response, {
        '상태 코드 정상': (r) => r.status === 201,
    });

    if (!checkResult) {
        console.error(
            `결제 요청 오류: UserID ${userId}, OrderID ${orderId}, 상태 코드: ${response.status}, 응답: ${response.body}`,
        );
    }

    return response.body;
}
