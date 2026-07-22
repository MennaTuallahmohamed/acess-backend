-- CreateEnum
CREATE TYPE "GlassAssetStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "GlassCurrentStatus" AS ENUM ('NOT_INSPECTED', 'OK', 'NOT_OK', 'NEEDS_FOLLOW_UP');

-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'GLASS';

-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "glassId" INTEGER;

-- AlterTable
ALTER TABLE "InspectionTask" ADD COLUMN     "glassId" INTEGER;

-- AlterTable
ALTER TABLE "InspectionTaskItem" ADD COLUMN     "glassId" INTEGER;

-- AlterTable
ALTER TABLE "TechnicianActivityLog" ADD COLUMN     "glassId" INTEGER;

-- CreateTable
CREATE TABLE "Glass" (
    "id" SERIAL NOT NULL,
    "cluster" TEXT NOT NULL,
    "building" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "lane" TEXT,
    "glassType" TEXT,
    "thickness" TEXT,
    "locationId" INTEGER,
    "status" "GlassAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentStatus" "GlassCurrentStatus" NOT NULL DEFAULT 'NOT_INSPECTED',
    "installDate" TIMESTAMP(3),
    "lastInspectionAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Glass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Glass_cluster_idx" ON "Glass"("cluster");

-- CreateIndex
CREATE INDEX "Glass_building_idx" ON "Glass"("building");

-- CreateIndex
CREATE INDEX "Glass_zone_idx" ON "Glass"("zone");

-- CreateIndex
CREATE INDEX "Glass_direction_idx" ON "Glass"("direction");

-- CreateIndex
CREATE INDEX "Glass_lane_idx" ON "Glass"("lane");

-- CreateIndex
CREATE INDEX "Glass_locationId_idx" ON "Glass"("locationId");

-- CreateIndex
CREATE INDEX "Glass_status_idx" ON "Glass"("status");

-- CreateIndex
CREATE INDEX "Glass_currentStatus_idx" ON "Glass"("currentStatus");

-- CreateIndex
CREATE INDEX "Glass_lastInspectionAt_idx" ON "Glass"("lastInspectionAt");

-- CreateIndex
CREATE UNIQUE INDEX "Glass_cluster_building_zone_direction_key" ON "Glass"("cluster", "building", "zone", "direction");

-- CreateIndex
CREATE INDEX "Inspection_glassId_idx" ON "Inspection"("glassId");

-- CreateIndex
CREATE INDEX "InspectionTask_glassId_idx" ON "InspectionTask"("glassId");

-- CreateIndex
CREATE INDEX "InspectionTaskItem_glassId_idx" ON "InspectionTaskItem"("glassId");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionTaskItem_taskId_glassId_key" ON "InspectionTaskItem"("taskId", "glassId");

-- CreateIndex
CREATE INDEX "TechnicianActivityLog_glassId_idx" ON "TechnicianActivityLog"("glassId");

-- AddForeignKey
ALTER TABLE "Glass" ADD CONSTRAINT "Glass_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionTask" ADD CONSTRAINT "InspectionTask_glassId_fkey" FOREIGN KEY ("glassId") REFERENCES "Glass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionTaskItem" ADD CONSTRAINT "InspectionTaskItem_glassId_fkey" FOREIGN KEY ("glassId") REFERENCES "Glass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_glassId_fkey" FOREIGN KEY ("glassId") REFERENCES "Glass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianActivityLog" ADD CONSTRAINT "TechnicianActivityLog_glassId_fkey" FOREIGN KEY ("glassId") REFERENCES "Glass"("id") ON DELETE SET NULL ON UPDATE CASCADE;
