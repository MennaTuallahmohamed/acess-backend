import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { LocationsModule } from './modules/locations/locations.module';
import { InspectionsModule } from './modules/inspections/inspections.module';
import { InspectionTasksModule } from './modules/inspections/inspection-tasks.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DevicesModule } from './modules/devices/devices.module';
import { IssuesModule } from './issues/issues.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    LocationsModule,
    InspectionsModule,
    InspectionTasksModule,
    DashboardModule,
    DevicesModule,
    IssuesModule,
  ],
})
export class AppModule {}