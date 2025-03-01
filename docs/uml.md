# 1. Sequence Diagram

---

**시퀀스 다이어그램 표기법**

| 기호 | 선 종류             | 응답 종류 | 의미                                |
| ---- | ------------------- | --------- | ----------------------------------- |
| ->>  | 실선                | 호출      | 데이터 전달 또는 메서드 호출        |
| -->> | 점선                | 응답      | 응답, 결과 반환                     |
| -)   | 화살 끝이 열린 실선 | 호출      | 데이터 전달 또는 메서드 호출(async) |
| --)  | 화살 끝이 열린 점선 | 응답      | 응답, 결과 반환(async)              |

### 1. 잔액 충전 시퀀스 다이어그램

```mermaid
sequenceDiagram
autonumber
    actor Client
    participant Controller
    participant Service
    participant Repository

    Client ->> Controller: API 요청
    activate Controller
    Controller ->> Service: 포인트 충전(userId, amount)
    activate Service

    Service ->> Service: 충전 금액 유효성 검사
    alt 충전 금액 비정상
        Service -->> Controller: BadRequest 예외 발생
        Controller -->> Client: 400 응답
    end

    Service ->> Repository: 유저 정보 조회(userId)
    activate Repository
    Repository -->> Service: 유저 정보 반환
    deactivate Repository
    alt 유저가 없을때
        Service -->> Controller: NotFound 예외 발생
        Controller -->> Client: 404 응답
    end

    Service ->> Service: 총 충전 잔액 연산
    Service ->> Repository: 잔액 수정(userId, amount)
    activate Repository
    Repository -->> Service: 성공 여부 반환
    deactivate Repository
    Service -->> Controller: 충전 결과 반환
    deactivate Service
    Controller -->> Client: 200 / 결과 응답
    deactivate Controller
```

### 2. 잔액 조회 시퀀스 다이어 그램

```mermaid
sequenceDiagram
autonumber
    actor Client
    participant Controller
    participant Service
    participant Repository

    Client ->> Controller: API 요청
    activate Controller
    Controller ->> Service: 유저 잔액 조회(userId)
    activate Service
    Service ->> Repository: 유저 잔액 조회(userId)
    activate Repository
    Repository -->> Service: 유저 잔액 정보 반환
    deactivate Repository

    alt 유저 정보 없을때
        Service -->> Controller: NotFound 예외 발생
        Controller -->> Client: 404 응답
    end

    Service -->> Controller: 유저 잔액 정보 반환
    deactivate Service
    Controller -->> Client: 200 / 결과 응답
    deactivate Controller
```

### 3. 상품 조회 시퀀스 다이어그램

```mermaid
sequenceDiagram
autonumber
    actor Client
    participant Controller
    participant Service
    participant Repository

    Client ->> Controller: API 요청
    activate Controller

    Controller ->> Service: 상품 목록 조회()
    activate Service

    Service ->> Repository: 상품 목록 조회()
    activate Repository

    Repository -->> Service: 상품 정보 반환
    deactivate Repository

    Note over Controller, Service: 상품 정보 없을 경우 []
    Service -->> Controller: 상품 정보 반환
    deactivate Service

    Controller -->> Client: 200 / 결과 응답
    deactivate Controller
```

### 4. 상위 상품 조회 시퀀스 다이어그램

```mermaid
sequenceDiagram
autonumber
    actor Client
    participant Controller
    participant Service
    participant Repository

    Client ->> Controller: API 요청
    activate Controller
    Controller ->> Service: 상위 상품 조회()
    activate Service
    Service ->> Service: 일자 산출

    Service ->> Repository: 상위 상품 조회(일자)
    activate Repository

    Repository -->> Service: 상위 상품 정보 반환
    deactivate Repository

    Service -->> Controller: 상위 상품 정보 반환
    deactivate Service

    Controller -->> Client: 200 / 결과 응답
    deactivate Controller
```

### 5. 선착순 쿠폰 발급 시퀀스 다이어그램

```mermaid
sequenceDiagram
autonumber
    actor Client
    participant Controller
    participant Service
    participant Repository

    Client ->> Controller: API 요청
    activate Controller

    Controller ->> Service: 쿠폰 발급(userId, couponId)
    activate Service

    Service ->> Repository: 쿠폰 정보 조회(couponId)
    Note over Repository: 발급 받을 쿠폰 락 적용(FOR UPDATE)
    activate Repository

    Repository -->> Service: 쿠폰 정보 반환
    deactivate Repository

    alt 잔여 수량 <= 0
        Service -->> Controller: Conflict 예외 발생
        Controller -->> Client: 409 응답
    end

    Service ->> Repository: 쿠폰 발급(userId, couponId)
    activate Repository
    Repository ->> Repository: 쿠폰 수량 차감
    Repository -->> Service: 쿠폰 발급 결과 반환
    deactivate Repository

    Service -->> Controller: 쿠폰 발급 결과 반환
    deactivate Service

    Controller -->> Client: 200 / 결과 응답
    deactivate Controller
```

### 7. 상품 주문 시퀀스 다이어그램

```mermaid
sequenceDiagram
autonumber
    actor cl as Client
    participant co as Controller
    participant s as Service
    participant r as Repository

    cl ->> co: API 요청
    activate co

    co ->> s: 주문 요청(userId, couponId, [product, ...])
    activate s

    s ->> s: 주문 상품 ids 배열 추출
    s ->> r: 주문 상품 조회([...ids])
    activate r
    r -->> s: 주문 상품 정보 반환
    deactivate r

    loop 주문 상품
        opt 주문 상품 재고 <= 0
            s -->> co: Conflict 예외 발생
            co -->> cl: 409 응답
        end
    end

    s -->> r: 쿠폰 정보 조회(userId, couponId)
    activate r
    r -->> s: 쿠폰 정보 반환
    deactivate r

    opt 쿠폰 비정상
        s -->> co: BadRequest 예외 발생
        co -->> cl: 404 응답
    end

    s ->> s: 총 결제 금액 - 쿠폰 할인 금액 산출
    s ->> r: 쿠폰 상태 수정(userCoupon)

    s ->> r: 유저 정보 조회(userId)
    activate r
    r -->> s: 유저 정보 반환
    deactivate r

    alt 유저 정보 없을 경우
        s -->> co: NotFound 예외 발생
        co -->> cl: 404 응답
    else 결제 금액 > 잔액
        s -->> co: BadRequest 예외 발생
        co -->> cl: 400 응답
    end

    s ->> r: 주문 생성(order)
    activate r
    r -->> s: 주문 생성 결과 반환
    deactivate r
    s -->> co: 주문 생성 결과 반환
    co -->> cl: 200 / 주문 정보 응답
```

### 8. 결제 시퀀스 다이어그램

```mermaid
sequenceDiagram
autonumber
    actor cl as Client
    participant co as Controller
    participant s as Service
    participant r as Repository
    participant df as DataPlatform

    cl ->> co: API 요청
    activate co

    co ->> s: 결제 요청(order)
    s ->> r: (FOR UPDATE)주문 정보 조회(order)
    Note over s,r: 주문 정보: 주문 상품, 재고, 결제금액
    activate r
    r -->> s: 주문 정보 반환
    deactivate r

    s ->> r: (FOR UPDATE)유저 정보 조회
    activate r
    r -->> s: 유저 정보 반환
    deactivate r

    alt 주문 정보 없을 경우
        s -->> co: NotFound 예외 발생
        co -->> cl: 404 응답
    else 유저 정보 없을 경우
        s -->> co: NotFound 예외 발생
        co -->> cl: 404 응답
    else 결제 금액 > 잔액
        s -->> co: BadRequest 예외 발생
        co -->> cl: 400 응답
    end

    loop 주문 상품
        opt 주문 상품 재고 <= 0
            s -->> co: Conflict 예외 발생
            co -->> cl: 409 응답
        end
    end

    s ->> r: 유저 결제 금액 차감(order)
    activate r
    loop 주문 상품
        s ->> r: 주문 상품 재고 차감(order)
    end
    s ->> r: 주문 상태 수정(order)
    s -) df: 주문 데이터 전달(order)

    r -->> s: 결제 응답 반환
    deactivate r

    s -->> co: 결제 응답 반환
    co -->> cl: 200/ 결제 정보
```

# 2. Flow Chart

```mermaid
flowchart TD
user(사용자) --> main[메인]

%% 쿠폰 조회
main -->|쿠폰| c1(사용자 보유 쿠폰 조회)
c1 --> c2{사용자 보유 쿠폰 존재 여부}
c2 --> |존재| c3(쿠폰 리스트 표시)
c2 --> |미존재| c4(빈 화면)

%%쿠폰 발급
main -->|쿠폰 발급| cc1[사용자 발급 가능 쿠폰 조회]
cc1 --> cc2{발급 가능 쿠폰 존재 여부}
cc2 --> |존재| cc3[발급 가능 쿠폰 리스트 조회]
cc2 --> |미존재| cc4(쿠폰 발급 프로세스 종료)
cc3 --> cc5{쿠폰 발급 신청 여부}
cc5 --> |신청| cc6{쿠폰 잔여 수량 검증}
cc5 --> |미신청| cc7[쿠폰 발급 프로세스 종료]
cc6 --> |잔여 수량 > 0| cc8[쿠폰 수량 감소]
cc6 --> |잔여 수량 <=0| cc9[예외 반환]
cc9 --> cc10(발급 실패)
cc8 --> cc11[쿠폰 발급 정보 저장]
cc11 --> cc12(쿠폰 발급 완료)

%%잔액 조회
main -->|잔액 조회| b(사용자 잔액 조회)
b --> b1(사용자 잔액 표시)

%%잔액 충전
main --> |잔액 충전| bb1(사용자 잔액 충전)
bb1 --> bb2[/충전 잔액 입력/]
bb2 --> bb2.1{충전 잔액 유효성 검사}
bb2.1 --> |비정상| bb4[예외 반환]
bb4 --> bb5(충전 프로세스 종료)
bb2.1 --> |정상| bb3[사용자 잔액 조회]
bb3 --> bb6[총 잔액 산출]
bb6 --> bb7[충전 금액 적용]
bb7 --> bb8(충전 완료)

%%상품
main --> |상품 목록 조회| p1[상품 조회]
p1 --> p2{상품 목록 존재 여부}
p2 --> |미존재| p3(빈 화면)
p2 --> |존재| p4[상품 리스트 표시]

%%상위 상품
main --> |상위 상품 조회| sp1[상위 상품 조회]
sp1 --> sp2{상위 상품 목록 존재 여부}
sp2 --> |미존재| sp3(빈 화면)
sp2 --> |존재| sp4[상위 상품 리스트 표시]

%% 주문
p4 --> o{주문 여부}
sp4 --> o

o --> |주문x| o11(대기기)
o --> |주문o| o1[/주문, 상품, 쿠폰 정보 입력/]
o1 --> o2{상품 재고 확인}
o2 --> |재고x| o3[예외 반환]
o2 --> |재고o| o4{쿠폰 유효성 검사}
o4 --> |정상| o3
o4 --> |비정상상| o5(할인 금액 적용)
o5 --> o6{보유 잔액 검증}
o6 --> |결제 금액 > 보유 잔액| o3
o6 --> |결제 금액 < 보유 잔액| o7[주문 정보 저장]
o3 --> o8(주문 실패)

%% 결제
o7 --> pay1{결제 여부}
pay1 --> |결제x| o9(주문 완료)
pay1 --> |결제o| pay2{주문 정보 검증}
pay2 --> |주문 정보 비정상| pay3[예외 반환]
pay3 --> pay3.1(결제 프로세스 종료)
pay2 --> |주문 정보 정상| pay4[결제 금액 차감]
pay4 --> pay5[주문 상품 재고 차감]
pay5 --> pay6[주문 상태 수정]
pay6 --> pay7(결제 완료)
```
