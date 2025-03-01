import http from 'k6/http';
import { check } from 'k6';

/**
 * 주문 시나리오
 * 1. 선착순 쿠폰 발급
 */

export let options = {
    scenarios: {
        contacts: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '10s', target: 250 }, //초반 부하 생성
                { duration: '20s', target: 100 },
                { duration: '30s', target: 50 },
                { duration: '10s', target: 0 },
            ],
            gracefulStop: '0s',
        },
    },
};

const BASE_URL = 'http://localhost:3030';

function issueCouponWithOptimisticLock() {
    const params = {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'issueCouponWithOptimisticLock' },
    };

    const userId = Math.floor(Math.random() * 1_000_000) + 1;
    const couponId = 7;

    const response = http.post(`${BASE_URL}/coupon/${couponId}/issue?userId=${userId}`, params);

    const checkResult = check(response, {
        '상태 코드 정상': (r) => r.status === 201,
    });

    if (!checkResult) {
        console.error(
            `쿠폰 발급 오류: UserID ${userId}, 상태 코드: ${response.status}, 응답: ${response.body}`,
        );
    }
}

function issueCouponWithRedisStructure() {
    const params = {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'issueCouponWithRedisStructure' },
    };

    const userId = Math.floor(Math.random() * 1_000_000) + 1;
    const couponId = 6;

    const response = http.post(
        `${BASE_URL}/coupon/${couponId}/issue/redis/structure?userId=${userId}`,
        params,
    );

    const checkResult = check(response, {
        '상태 코드 정상': (r) => r.status === 201,
    });

    if (!checkResult) {
        console.error(
            `쿠폰 발급 오류: UserID ${userId}, 상태 코드: ${response.status}, 응답: ${response.body}`,
        );
    }
}

export default function () {
    issueCouponWithOptimisticLock();
    issueCouponWithRedisStructure();
}
