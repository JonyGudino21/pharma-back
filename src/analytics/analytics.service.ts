import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GetDashboardDto } from './dto/get-dashboard.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { SaleFlowStatus, SaleStatus, Prisma } from '@prisma/client';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  async getDashboardSummary(dto: GetDashboardDto) {
    const { startDate, endDate } = this.getDateRange(dto);

    // Filtro base para ventas: Solo ventas cerradas y no canceladas en el rango de fechas
    const salesWhere: Prisma.SaleWhereInput = {
      flowStatus: SaleFlowStatus.COMPLETED,
      status: { not: SaleStatus.CANCELLED },
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    // Ejecutar todas las consultas pesadas en PARALELO para máxima velocidad
    const [kpis, liquidity, paymentTrends, topProducts] = await Promise.all([
      this.getFinancialKPIs(salesWhere),
      this.getLiquiditySnapshot(), // La liquidez no usa fechas, es el estado ACTUAL
      this.getSalesByPaymentMethod(salesWhere),
      this.getTopProducts(startDate, endDate), // Usamos raw query por rendimiento
    ]);

    return {
      period: {
        startDate,
        endDate,
      },
      kpis,
      liquidity,
      trends: {
        salesByPaymentMethod: paymentTrends,
        topSellingProducts: topProducts,
      },
    };
  }

  // --- MÉTODOS PRIVADOS DE EXTRACCIÓN DE DATOS ---

  /**
   * 1. KPIs Financieros (Lo que el dueño ve primero)
   */
  private async getFinancialKPIs(where: Prisma.SaleWhereInput) {
    const agg = await this.prisma.sale.aggregate({
      where,
      _count: { id: true },
      _sum: {
        total: true,       // Ventas brutas
        totalCost: true,   // Costo de lo vendido (COGS)
        profit: true,      // Utilidad Bruta
      },
    });

    const totalSales = new Decimal(agg._sum.total ?? 0);
    const totalProfit = new Decimal(agg._sum.profit ?? 0);
    const totalTransactions = agg._count.id;

    // Matemáticas de negocio
    const margin = totalSales.gt(0) 
      ? totalProfit.dividedBy(totalSales).mul(100) 
      : new Decimal(0);
      
    const averageTicket = totalTransactions > 0 
      ? totalSales.dividedBy(totalTransactions) 
      : new Decimal(0);

    return {
      totalSales: totalSales.toNumber(),
      totalCost: Number(agg._sum.totalCost ?? 0),
      grossProfit: totalProfit.toNumber(),
      marginPercentage: Number(margin.toFixed(2)), // Ej: 35.50 %
      averageTicket: Number(averageTicket.toFixed(2)),
      totalTransactions,
    };
  }

  /**
   * 2. Liquidez y Salud del Negocio (Foto Actual)
   */
  private async getLiquiditySnapshot() {
    // A. Cuentas por Cobrar (Clientes nos deben)
    const clientsAgg = await this.prisma.client.aggregate({
      where: { isActive: true },
      _sum: { currentDebt: true },
    });

    // B. Cuentas por Pagar (Debemos a Proveedores)
    const suppliersAgg = await this.prisma.supplier.aggregate({
      where: { isActive: true },
      _sum: { balance: true },
    });

    // C. Valor del Inventario Congelado
    // Optimización: Solo traer stock y costo de productos activos con stock
    const products = await this.prisma.product.findMany({
      where: { isActive: true, stock: { gt: 0 } },
      select: { stock: true, cost: true },
    });
    
    const inventoryValue = products.reduce(
      (sum, p) => sum.add(new Decimal(p.stock).mul(new Decimal(p.cost))),
      new Decimal(0)
    );

    return {
      accountsReceivable: Number(clientsAgg._sum.currentDebt ?? 0),
      accountsPayable: Number(suppliersAgg._sum.balance ?? 0),
      inventoryValue: inventoryValue.toNumber(),
    };
  }

  /**
   * 3. Tendencias Operativas: Método de Pago
   */
  private async getSalesByPaymentMethod(where: Prisma.SaleWhereInput) {
    const grouped = await this.prisma.sale.groupBy({
      by: ['paymentMethod'],
      where,
      _sum: { total: true },
      _count: { id: true },
    });

    return grouped.map(g => ({
      method: g.paymentMethod,
      totalAmount: Number(g._sum.total ?? 0),
      count: g._count.id,
    }));
  }

  /**
   * 4. Top 5 Productos más vendidos.
   * Uso de Raw SQL para mayor rendimiento al cruzar SaleItem con Product y Sale.
   */
  private async getTopProducts(startDate: Date, endDate: Date) {
    // RAW QUERY: Máximo rendimiento para reportes complejos. 
    // Evita cargar miles de filas a la memoria de Node.js
    const result = await this.prisma.$queryRaw`
      SELECT 
        p."name",
        p."sku",
        CAST(SUM(si."quantity") AS INTEGER) as "totalQuantity",
        CAST(SUM(si."subtotal") AS FLOAT) as "totalRevenue"
      FROM "SaleItem" si
      JOIN "Product" p ON p."id" = si."productId"
      JOIN "Sale" s ON s."id" = si."saleId"
      WHERE s."flowStatus" = 'COMPLETED' 
        AND s."status" != 'CANCELLED'
        AND s."createdAt" >= ${startDate} 
        AND s."createdAt" <= ${endDate}
      GROUP BY p."id", p."name", p."sku"
      ORDER BY "totalQuantity" DESC
      LIMIT 5
    `;

    return result;
  }

  // --- HELPER DE FECHAS ---
  private getDateRange(dto: GetDashboardDto) {
    const now = new Date();
    
    // Si no mandan inicio, tomamos el primer día del mes actual
    let startDate = dto.startDate 
      ? new Date(dto.startDate) 
      : new Date(now.getFullYear(), now.getMonth(), 1);
      
    // Si no mandan fin, tomamos hoy al final del día
    let endDate = dto.endDate 
      ? new Date(dto.endDate) 
      : new Date();
      
    // Asegurar que startDate sea a las 00:00:00 y endDate a las 23:59:59
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    return { startDate, endDate };
  }
}