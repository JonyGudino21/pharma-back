-- CreateEnum
CREATE TYPE "public"."SaleFlowStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "public"."Sale" ADD COLUMN     "flowStatus" "public"."SaleFlowStatus" NOT NULL DEFAULT 'DRAFT';
