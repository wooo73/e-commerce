import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { TransactionClient, TransactionManager } from './transaction-client';

@Injectable()
export class PrismaTransactionManager implements TransactionManager {
    constructor(private readonly prisma: PrismaService) {}

    async transaction<T>(action: (tx: TransactionClient) => Promise<T>): Promise<T> {
        return await this.prisma.$transaction(
            (prismaTx) => {
                const client: TransactionClient = { prisma: prismaTx };
                return action(client);
            },
            {
                maxWait: 10000, // 10초
                timeout: 30000, // 30초
            },
        );
    }
}
