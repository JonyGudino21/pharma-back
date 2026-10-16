import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isUniqueConstraintError } from 'src/common/utils/prisma-error.util';
import {
  DEFAULT_COMPANY,
  DEFAULT_RECEIPT_LAYOUT,
  normalizeReceiptLayout,
} from './receipt-layout';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CreateReceiptTemplateDto } from './dto/create-receipt-template.dto';
import { UpdateReceiptTemplateDto } from './dto/update-receipt-template.dto';

const TEMPLATE_SELECT = {
  id: true,
  companyId: true,
  name: true,
  paperWidthMm: true,
  showLogo: true,
  showTaxId: true,
  showAddress: true,
  showPhone: true,
  fontScale: true,
  layout: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ficha fiscal + plantillas. Crea la fila semilla si la instalación
   * arrancó sin correr el INSERT de la migración (tests, restores).
   */
  async getProfile() {
    const company = await this.ensureCompany();
    const templates = await this.prisma.receiptTemplate.findMany({
      where: { companyId: company.id },
      select: TEMPLATE_SELECT,
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
    const active = templates.filter((t) => t.isActive);
    const defaultTemplate =
      active.find((t) => t.isDefault) ?? active[0] ?? null;

    return { company, templates, defaultTemplate };
  }

  async updateCompany(dto: UpdateCompanyDto) {
    const company = await this.ensureCompany();
    return this.prisma.company.update({
      where: { id: company.id },
      data: {
        ...(dto.legalName !== undefined && { legalName: dto.legalName.trim() }),
        ...(dto.tradeName !== undefined && { tradeName: dto.tradeName.trim() }),
        ...(dto.rfc !== undefined && { rfc: dto.rfc.trim().toUpperCase() }),
        ...(dto.fiscalRegime !== undefined && {
          fiscalRegime: dto.fiscalRegime,
        }),
        ...(dto.address !== undefined && { address: dto.address.trim() }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.ticketFooter !== undefined && {
          ticketFooter: dto.ticketFooter,
        }),
      },
    });
  }

  async createTemplate(dto: CreateReceiptTemplateDto) {
    const company = await this.ensureCompany();
    const layout = this.parseLayout(dto.layout);

    return this.prisma.$transaction(async (tx) => {
      let makeDefault = dto.isDefault === true;
      if (makeDefault) {
        await tx.receiptTemplate.updateMany({
          where: { companyId: company.id, isDefault: true },
          data: { isDefault: false },
        });
      } else {
        const hasDefault = await tx.receiptTemplate.findFirst({
          where: { companyId: company.id, isDefault: true, isActive: true },
          select: { id: true },
        });
        if (!hasDefault) makeDefault = true;
      }

      return tx.receiptTemplate.create({
        data: {
          companyId: company.id,
          name: dto.name.trim(),
          paperWidthMm: dto.paperWidthMm ?? 58,
          showLogo: dto.showLogo ?? true,
          showTaxId: dto.showTaxId ?? true,
          showAddress: dto.showAddress ?? true,
          showPhone: dto.showPhone ?? true,
          fontScale: dto.fontScale ?? 1,
          layout,
          isDefault: makeDefault,
        },
        select: TEMPLATE_SELECT,
      });
    });
  }

  async updateTemplate(id: number, dto: UpdateReceiptTemplateDto) {
    const template = await this.requireTemplate(id);
    const layout =
      dto.layout !== undefined ? this.parseLayout(dto.layout) : undefined;

    if (dto.isActive === false) {
      await this.assertCanDeactivate(template.companyId, template.id);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.receiptTemplate.updateMany({
          where: {
            companyId: template.companyId,
            isDefault: true,
            id: { not: template.id },
          },
          data: { isDefault: false },
        });
      }

      const updated = await tx.receiptTemplate.update({
        where: { id: template.id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.paperWidthMm !== undefined && {
            paperWidthMm: dto.paperWidthMm,
          }),
          ...(dto.showLogo !== undefined && { showLogo: dto.showLogo }),
          ...(dto.showTaxId !== undefined && { showTaxId: dto.showTaxId }),
          ...(dto.showAddress !== undefined && {
            showAddress: dto.showAddress,
          }),
          ...(dto.showPhone !== undefined && { showPhone: dto.showPhone }),
          ...(dto.fontScale !== undefined && { fontScale: dto.fontScale }),
          ...(layout !== undefined && { layout }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
        select: TEMPLATE_SELECT,
      });

      if (updated.isDefault && updated.isActive === false) {
        await this.promoteAnotherDefault(tx, template.companyId, template.id);
        return tx.receiptTemplate.update({
          where: { id: template.id },
          data: { isDefault: false },
          select: TEMPLATE_SELECT,
        });
      }

      if (dto.isActive === false && template.isDefault) {
        await this.promoteAnotherDefault(tx, template.companyId, template.id);
        return tx.receiptTemplate.update({
          where: { id: template.id },
          data: { isDefault: false },
          select: TEMPLATE_SELECT,
        });
      }

      return updated;
    });
  }

  async setDefault(id: number) {
    const template = await this.requireTemplate(id);
    if (!template.isActive) {
      throw new BadRequestException(
        'No se puede usar como predeterminada una plantilla inactiva',
      );
    }

    await this.prisma.$transaction([
      this.prisma.receiptTemplate.updateMany({
        where: { companyId: template.companyId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.receiptTemplate.update({
        where: { id: template.id },
        data: { isDefault: true },
      }),
    ]);

    return this.prisma.receiptTemplate.findUniqueOrThrow({
      where: { id: template.id },
      select: TEMPLATE_SELECT,
    });
  }

  async deactivateTemplate(id: number) {
    return this.updateTemplate(id, { isActive: false });
  }

  async requireActiveTemplate(id: number) {
    const template = await this.prisma.receiptTemplate.findUnique({
      where: { id },
      select: TEMPLATE_SELECT,
    });
    if (!template || !template.isActive) {
      throw new NotFoundException('Plantilla de ticket no encontrada');
    }
    return template;
  }

  private parseLayout(layout: unknown) {
    try {
      return normalizeReceiptLayout(layout) as unknown as Prisma.InputJsonValue;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Layout de ticket inválido',
      );
    }
  }

  private async requireTemplate(id: number) {
    const template = await this.prisma.receiptTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException('Plantilla de ticket no encontrada');
    }
    return template;
  }

  private async assertCanDeactivate(companyId: number, templateId: number) {
    const remaining = await this.prisma.receiptTemplate.count({
      where: {
        companyId,
        isActive: true,
        id: { not: templateId },
      },
    });
    if (remaining === 0) {
      throw new BadRequestException(
        'Debe quedar al menos una plantilla de ticket activa',
      );
    }
  }

  private async promoteAnotherDefault(
    tx: Prisma.TransactionClient,
    companyId: number,
    exceptId: number,
  ) {
    const next = await tx.receiptTemplate.findFirst({
      where: { companyId, isActive: true, id: { not: exceptId } },
      orderBy: { id: 'asc' },
    });
    if (next) {
      await tx.receiptTemplate.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }

  private async ensureCompany() {
    const existing = await this.prisma.company.findUnique({
      where: { singletonKey: DEFAULT_COMPANY.singletonKey },
    });
    if (existing) return existing;

    try {
      return await this.prisma.company.create({
        data: {
          singletonKey: DEFAULT_COMPANY.singletonKey,
          legalName: DEFAULT_COMPANY.legalName,
          tradeName: DEFAULT_COMPANY.tradeName,
          rfc: DEFAULT_COMPANY.rfc,
          address: DEFAULT_COMPANY.address,
          ticketFooter: DEFAULT_COMPANY.ticketFooter,
          templates: {
            create: {
              name: 'Térmica 58 mm',
              paperWidthMm: 58,
              isDefault: true,
              layout:
                DEFAULT_RECEIPT_LAYOUT as unknown as Prisma.InputJsonValue,
            },
          },
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return this.prisma.company.findUniqueOrThrow({
          where: { singletonKey: DEFAULT_COMPANY.singletonKey },
        });
      }
      throw error;
    }
  }
}
