-- DropForeignKey
ALTER TABLE "public"."Product" DROP CONSTRAINT "Product_categoryId_fkey";

-- AlterTable
ALTER TABLE "public"."Product" ALTER COLUMN "categoryId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Client_phone_idx" ON "public"."Client"("phone");

-- CreateIndex
CREATE INDEX "Client_email_idx" ON "public"."Client"("email");

-- CreateIndex
CREATE INDEX "UserToken_token_idx" ON "public"."UserToken"("token");

-- CreateIndex
CREATE INDEX "UserToken_userId_idx" ON "public"."UserToken"("userId");

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
