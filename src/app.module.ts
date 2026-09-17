import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { TasksModule } from './modules/tasks/tasks.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ClientsModule } from './modules/clients/clients.module';
import { DossiersModule } from './modules/dossiers/dossiers.module';
import { EvenementsModule } from './modules/evenements/evenements.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { FacturesModule } from './modules/factures/factures.module';
import { ProvisionsModule } from './modules/provisions/provisions.module';
import { ActivityLogModule } from './modules/activity-log/activity-log.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PaiementsModule } from './modules/paiements/paiements.module';
import { FinanceModule } from './modules/finance/finance.module';
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    ClientsModule,
    DossiersModule,
    EvenementsModule,
    DocumentsModule,
    FacturesModule,
    ProvisionsModule,
    ActivityLogModule,
    DashboardModule,
    TasksModule,
    PaiementsModule,
    FinanceModule,
  ],

  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule { }
