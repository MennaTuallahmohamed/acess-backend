import { Prisma } from '@prisma/client';

export const gatePublicSelect = {
  id: true,
  gateNo: true,

  cluster: true,
  building: true,
  zone: true,
  direction: true,
  lane: true,
  type: true,
  excelId: true,

  locationId: true,
  status: true,
  currentStatus: true,

  notes: true,
  lastInspectionAt: true,
  createdAt: true,
  updatedAt: true,

  location: {
    select: {
      id: true,
      excelId: true,
      cluster: true,
      building: true,
      zone: true,
      direction: true,
      lane: true,
      type: true,
    },
  },

  _count: {
    select: {
      inspections: true,
      tasks: true,
      taskItems: true,
    },
  },

  // secretCode ممنوع يتحط هنا
} satisfies Prisma.GateSelect;