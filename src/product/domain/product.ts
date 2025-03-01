export class ProductDomain {
    id: number;
    name: string;
    price: number;
    status: string;
    createdAt: Date;
    updatedAt: Date;

    static from({
        id,
        name,
        price,
        status,
        createdAt,
        updatedAt,
    }: {
        id: number;
        name: string;
        price: number;
        status: string;
        createdAt: Date;
        updatedAt: Date;
    }) {
        const domain = new ProductDomain();
        domain.id = id;
        domain.name = name;
        domain.price = price;
        domain.status = status;
        domain.createdAt = createdAt;
        domain.updatedAt = updatedAt;
        return domain;
    }
}
