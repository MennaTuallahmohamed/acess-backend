import { Module } from '@nestjs/common';

import { PrismaModule } from './database/prisma/prisma.module';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { LocationsModule } from './modules/locations/locations.module';

import { InspectionsModule } from './modules/inspections/inspections.module';
import { InspectionTasksModule } from './modules/inspections/inspection-tasks.module';
import { InspectionImageModule } from './modules/inspections/dto/inspection-image.module';

import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DevicesModule } from './modules/devices/devices.module';
import { DeviceReplacementsModule } from './modules/device-replacements/device-replacements.module';

import { IssuesModule } from './issues/issues.module';
import { ReportsModule } from './modules/reports/reports.module';

import { GatesModule } from './gates/gates.module';
import { InspectionWorkflowModule } from './modules/inspection-workflow/inspection-workflow.module';
import { GlassesModule } from './glasses/glasses.module';

@Module({
  imports: [
    PrismaModule,

    AuthModule,
    UsersModule,
    RolesModule,

    LocationsModule,
    DevicesModule,
    DeviceReplacementsModule,

    InspectionsModule,
    InspectionTasksModule,
    InspectionImageModule,

    DashboardModule,
    IssuesModule,
    ReportsModule,

    GatesModule,

    InspectionWorkflowModule,

    GlassesModule,
  ],
})
export class AppModule {}