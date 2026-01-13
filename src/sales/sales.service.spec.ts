import { Test, TestingModule } from '@nestjs/testing';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { BadRequestException } from '@nestjs/common';

const mockPrismaService = {
  product: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  sale: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  salePayment: {
    create: jest.fn(),
    aggregate: jest.fn(),
  },
  saleReturn: {
    create: jest.fn(),
  },
  saleReturnItem: {
    create: jest.fn(),
  },
  saleRefund: {
    create: jest.fn(),
  },
  saleItem: {
    findMany: jest.fn(),
  },
  clientProductPrice: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  clientProductPriceHistory: {
    create: jest.fn(),
  },
  $transaction: jest.fn((cb) => cb(mockPrismaService)),
};

describe('SalesService', () => {
  let service: SalesService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a sale with atomic stock updates', async () => {
      const dto = {
        items: [{ productId: 1, quantity: 2, price: 100 }],
      };
      
      mockPrismaService.product.findMany.mockResolvedValue([{ id: 1, name: 'Test Product', stock: 10 }]);
      mockPrismaService.product.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.sale.create.mockResolvedValue({ id: 1, total: new Decimal(200) });

      const result = await service.create(dto as any);

      expect(mockPrismaService.product.updateMany).toHaveBeenCalledWith({
        where: { id: 1, stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });
      expect(result).toBeDefined();
    });

    it('should throw if stock is insufficient', async () => {
       const dto = {
        items: [{ productId: 1, quantity: 20, price: 100 }],
      };
      mockPrismaService.product.findMany.mockResolvedValue([{ id: 1, name: 'Test Product', stock: 10 }]);
      mockPrismaService.product.updateMany.mockResolvedValue({ count: 0 }); // Fail update

      await expect(service.create(dto as any)).rejects.toThrow('Stock insuficiente');
    });
  });

  describe('addPayment', () => {
      it('should calculate payment status correctly', async () => {
          const saleId = 1;
          const dto = { method: 'CASH', amount: 50 };
          
          mockPrismaService.sale.findUnique.mockResolvedValue({ id: 1, total: new Decimal(100), status: 'PENDING' });
          mockPrismaService.salePayment.create.mockResolvedValue({});
          mockPrismaService.salePayment.aggregate.mockResolvedValue({ _sum: { amount: new Decimal(50) } });
          mockPrismaService.sale.update.mockResolvedValue({});

          const result = await service.addPayment(saleId, dto as any);
          
          expect(result.status).toBe('PARTIAL');
      });

       it('should complete sale if paid fully', async () => {
          const saleId = 1;
          const dto = { method: 'CASH', amount: 50 };
          
          mockPrismaService.sale.findUnique.mockResolvedValue({ id: 1, total: new Decimal(100), status: 'PARTIAL' });
          mockPrismaService.salePayment.create.mockResolvedValue({});
          mockPrismaService.salePayment.aggregate.mockResolvedValue({ _sum: { amount: new Decimal(100) } });
          mockPrismaService.sale.update.mockResolvedValue({});

          const result = await service.addPayment(saleId, dto as any);
          
          expect(result.status).toBe('COMPLETED');
      });
  });
});
