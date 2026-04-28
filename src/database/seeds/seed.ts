import {
  PrismaClient,
  UserStatus,
  DeviceCurrentStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('temp123', 10);

  // Roles
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN' },
  });

  const viewerRole = await prisma.role.upsert({
    where: { name: 'VIEWER' },
    update: {},
    create: { name: 'VIEWER' },
  });

  const technicianRole = await prisma.role.upsert({
    where: { name: 'TECHNICIAN' },
    update: {},
    create: { name: 'TECHNICIAN' },
  });

  // Device Types
  const accessControlType = await prisma.deviceType.upsert({
    where: { name: 'Access Control' },
    update: {},
    create: {
      name: 'Access Control',
      description: 'Main access control device',
    },
  });

  const readerType = await prisma.deviceType.upsert({
    where: { name: 'Reader' },
    update: {},
    create: {
      name: 'Reader',
      description: 'Reader device',
    },
  });

  const controllerType = await prisma.deviceType.upsert({
    where: { name: 'Controller' },
    update: {},
    create: {
      name: 'Controller',
      description: 'Controller device',
    },
  });

  // Locations
  const location1 = await prisma.location.upsert({
    where: { excelId: 'A60-001' },
    update: {
      cluster: 'cluster 3A/4A',
      building: 'وزارة التربية والتعليم',
      zone: 'zone 5 right',
      type: 'Argus 60',
      lane: '1',
      direction: 'IN',
    },
    create: {
      cluster: 'cluster 3A/4A',
      building: 'وزارة التربية والتعليم',
      zone: 'zone 5 right',
      type: 'Argus 60',
      lane: '1',
      direction: 'IN',
      excelId: 'A60-001',
    },
  });

  const location2 = await prisma.location.upsert({
    where: { excelId: 'M-001' },
    update: {
      cluster: 'cluster 3A/4A',
      building: 'وزارة التربية والتعليم',
      zone: 'zone 5 right',
      type: 'Morpho md',
      lane: '1',
      direction: 'IN',
    },
    create: {
      cluster: 'cluster 3A/4A',
      building: 'وزارة التربية والتعليم',
      zone: 'zone 5 right',
      type: 'Morpho md',
      lane: '1',
      direction: 'IN',
      excelId: 'M-001',
    },
  });

  // Users
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {
      firstName: 'Admin',
      lastName: 'User',
      fullName: 'Admin User',
      email: 'admin@ministry.gov.eg',
      passwordHash: hashedPassword,
      phone: '01000000000',
      officeNumber: 'A001',
      jobTitle: 'Admin',
      region: 'Head Office',
      notes: 'System administrator',
      isActive: true,
      status: UserStatus.ACTIVE,
      roleId: adminRole.id,
    },
    create: {
      firstName: 'Admin',
      lastName: 'User',
      fullName: 'Admin User',
      email: 'admin@ministry.gov.eg',
      username: 'admin',
      passwordHash: hashedPassword,
      phone: '01000000000',
      officeNumber: 'A001',
      jobTitle: 'Admin',
      region: 'Head Office',
      notes: 'System administrator',
      isActive: true,
      status: UserStatus.ACTIVE,
      roleId: adminRole.id,
    },
  });

  await prisma.user.upsert({
    where: { username: 'viewer' },
    update: {
      firstName: 'Viewer',
      lastName: 'User',
      fullName: 'Viewer User',
      email: 'viewer@ministry.gov.eg',
      passwordHash: hashedPassword,
      phone: '01000000001',
      officeNumber: 'V001',
      jobTitle: 'Viewer',
      region: 'Head Office',
      notes: 'Read only user',
      isActive: true,
      status: UserStatus.ACTIVE,
      roleId: viewerRole.id,
    },
    create: {
      firstName: 'Viewer',
      lastName: 'User',
      fullName: 'Viewer User',
      email: 'viewer@ministry.gov.eg',
      username: 'viewer',
      passwordHash: hashedPassword,
      phone: '01000000001',
      officeNumber: 'V001',
      jobTitle: 'Viewer',
      region: 'Head Office',
      notes: 'Read only user',
      isActive: true,
      status: UserStatus.ACTIVE,
      roleId: viewerRole.id,
    },
  });

  await prisma.user.upsert({
    where: { username: 'technician' },
    update: {
      firstName: 'Technician',
      lastName: 'User',
      fullName: 'Technician User',
      email: 'technician@ministry.gov.eg',
      passwordHash: hashedPassword,
      phone: '01000000002',
      officeNumber: 'T001',
      jobTitle: 'Technician',
      region: 'Zone A',
      notes: 'Field technician',
      isActive: true,
      status: UserStatus.ACTIVE,
      roleId: technicianRole.id,
    },
    create: {
      firstName: 'Technician',
      lastName: 'User',
      fullName: 'Technician User',
      email: 'technician@ministry.gov.eg',
      username: 'technician',
      passwordHash: hashedPassword,
      phone: '01000000002',
      officeNumber: 'T001',
      jobTitle: 'Technician',
      region: 'Zone A',
      notes: 'Field technician',
      isActive: true,
      status: UserStatus.ACTIVE,
      roleId: technicianRole.id,
    },
  });

  // Devices
  await prisma.device.upsert({
    where: { deviceCode: 'A60-001' },
    update: {
      deviceName: 'Argus 60',
      barcode: 'TEMP-A60-001',
      serialNumber: 'SN123',
      manufacturer: 'Argus',
      modelNumber: '60',
      currentStatus: DeviceCurrentStatus.OK,
      deviceTypeId: accessControlType.id,
      locationId: location1.id,
      notes: 'Imported from excel seed',
    },
    create: {
      deviceCode: 'A60-001',
      deviceName: 'Argus 60',
      barcode: 'TEMP-A60-001',
      serialNumber: 'SN123',
      manufacturer: 'Argus',
      modelNumber: '60',
      currentStatus: DeviceCurrentStatus.OK,
      deviceTypeId: accessControlType.id,
      locationId: location1.id,
      notes: 'Imported from excel seed',
    },
  });

  await prisma.device.upsert({
    where: { deviceCode: 'M-001' },
    update: {
      deviceName: 'Morpho md',
      barcode: 'TEMP-M-001',
      serialNumber: 'SN123456',
      manufacturer: 'Morpho',
      modelNumber: 'md',
      currentStatus: DeviceCurrentStatus.OK,
      deviceTypeId: readerType.id,
      locationId: location2.id,
      notes: 'Imported from excel seed',
    },
    create: {
      deviceCode: 'M-001',
      deviceName: 'Morpho md',
      barcode: 'TEMP-M-001',
      serialNumber: 'SN123456',
      manufacturer: 'Morpho',
      modelNumber: 'md',
      currentStatus: DeviceCurrentStatus.OK,
      deviceTypeId: readerType.id,
      locationId: location2.id,
      notes: 'Imported from excel seed',
    },
  });

  // Optional controller seed so controllerType is actually used
  await prisma.device.upsert({
    where: { deviceCode: 'C-001' },
    update: {
      deviceName: 'Main Controller',
      barcode: 'TEMP-C-001',
      serialNumber: 'SNCTRL001',
      manufacturer: 'Generic',
      modelNumber: 'CTRL-01',
      currentStatus: DeviceCurrentStatus.OK,
      deviceTypeId: controllerType.id,
      locationId: location1.id,
      notes: 'Controller sample device',
    },
    create: {
      deviceCode: 'C-001',
      deviceName: 'Main Controller',
      barcode: 'TEMP-C-001',
      serialNumber: 'SNCTRL001',
      manufacturer: 'Generic',
      modelNumber: 'CTRL-01',
      currentStatus: DeviceCurrentStatus.OK,
      deviceTypeId: controllerType.id,
      locationId: location1.id,
      notes: 'Controller sample device',
    },
  });

  console.log('DONE SEED DATA');
}

main()
  .catch((e) => {
    console.error('SEED ERROR:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });