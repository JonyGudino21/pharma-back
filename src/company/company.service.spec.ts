import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyService } from './company.service';
import { DEFAULT_RECEIPT_LAYOUT } from './receipt-layout';

describe('CompanyService — ficha fiscal y plantillas', () => {
  let service: CompanyService;

  const company = {
    id: 1,
    singletonKey: 'default',
    legalName: 'Mi Farmacia',
    tradeName: 'Mi Farmacia',
    rfc: '',
    fiscalRegime: null,
    address: '',
    phone: null,
    email: null,
    logoUrl: null,
    ticketFooter: 'Conserve su ticket.',
  };

  const plantilla58 = {
    id: 10,
    companyId: 1,
    name: 'Térmica 58 mm',
    paperWidthMm: 58,
    showLogo: true,
    showTaxId: true,
    showAddress: true,
    showPhone: true,
    fontScale: 1,
    layout: DEFAULT_RECEIPT_LAYOUT,
    isDefault: true,
    isActive: true,
  };

  const plantilla80 = {
    ...plantilla58,
    id: 11,
    name: 'Térmica 80 mm',
    paperWidthMm: 80,
    isDefault: false,
  };

  const prisma = {
    company: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    receiptTemplate: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => unknown)(prisma);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg;
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [CompanyService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(CompanyService);
  });

  it('crea la ficha fiscal si la instalación aún no tiene una', async () => {
    prisma.company.findUnique.mockResolvedValueOnce(null);
    prisma.company.create.mockResolvedValue(company);
    prisma.receiptTemplate.findMany.mockResolvedValue([plantilla58]);

    const profile = await service.getProfile();

    expect(prisma.company.create).toHaveBeenCalled();
    expect(profile.defaultTemplate?.id).toBe(10);
    expect(profile.templates).toHaveLength(1);
  });

  it('no duplica la empresa si otro GET ganó la carrera del insert', async () => {
    prisma.company.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(company);
    prisma.company.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prisma.company.findUniqueOrThrow.mockResolvedValue(company);
    prisma.receiptTemplate.findMany.mockResolvedValue([plantilla58]);

    const profile = await service.getProfile();
    expect(profile.company.id).toBe(1);
    expect(prisma.company.findUniqueOrThrow).toHaveBeenCalled();
  });

  it('al marcar una plantilla como default quita la bandera de las demás', async () => {
    prisma.receiptTemplate.findUnique.mockResolvedValue(plantilla80);
    prisma.receiptTemplate.updateMany.mockResolvedValue({ count: 1 });
    prisma.receiptTemplate.update.mockResolvedValue({
      ...plantilla80,
      isDefault: true,
    });
    prisma.receiptTemplate.findUniqueOrThrow.mockResolvedValue({
      ...plantilla80,
      isDefault: true,
    });

    const updated = await service.setDefault(11);

    expect(prisma.receiptTemplate.updateMany).toHaveBeenCalledWith({
      where: { companyId: 1, isDefault: true },
      data: { isDefault: false },
    });
    expect(updated.isDefault).toBe(true);
  });

  it('no deja desactivar la última plantilla activa', async () => {
    prisma.receiptTemplate.findUnique.mockResolvedValue(plantilla58);
    prisma.receiptTemplate.count.mockResolvedValue(0);

    await expect(service.deactivateTemplate(10)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.deactivateTemplate(10)).rejects.toThrow(
      /al menos una plantilla/,
    );
  });

  it('rechaza usar como predeterminada una plantilla inactiva', async () => {
    prisma.receiptTemplate.findUnique.mockResolvedValue({
      ...plantilla80,
      isActive: false,
    });

    await expect(service.setDefault(11)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('normaliza el RFC a mayúsculas al guardar la ficha', async () => {
    prisma.company.findUnique.mockResolvedValue(company);
    prisma.company.update.mockResolvedValue({
      ...company,
      rfc: 'XAXX010101000',
    });

    await service.updateCompany({ rfc: 'xaxx010101000' });

    const llamadas = prisma.company.update.mock.calls as Array<
      [{ data: { rfc: string } }]
    >;
    expect(llamadas[0][0].data.rfc).toBe('XAXX010101000');
  });

  it('lanza 404 si la plantilla no existe', async () => {
    prisma.receiptTemplate.findUnique.mockResolvedValue(null);
    await expect(service.setDefault(99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
