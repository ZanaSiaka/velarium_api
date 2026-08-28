import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
} from '@nestjs/common';

import {
    ApiBearerAuth,
    ApiTags,
} from '@nestjs/swagger';

import {
    CurrentUser,
    CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';

import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
    constructor(
        private readonly tasksService: TasksService,
    ) { }

    /**
     * Créer une tâche
     */
    @Post()
    create(
        @Body() dto: CreateTaskDto,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.tasksService.create(
            dto,
            user.id,
            user.role,
        );
    }

    /**
     * Récupérer les tâches
     *
     * AVOCAT :
     *    voit toutes les tâches.
     *
     * Autres rôles :
     *    voient uniquement leurs tâches.
     */
    @Get()
    findAll(
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.tasksService.findAll(
            user.id,
            user.role,
        );
    }

    /**
     * Récupérer une tâche
     */
    @Get(':id')
    findOne(
        @Param('id') id: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.tasksService.findOne(
            id,
            user.id,
            user.role,
        );
    }

    /**
     * Modifier une tâche
     */
    @Patch(':id')
    update(
        @Param('id') id: string,
        @Body() dto: Partial<CreateTaskDto>,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.tasksService.update(
            id,
            dto,
            user.id,
            user.role,
        );
    }

    /**
     * Changer le statut d'une tâche
     */
    @Patch(':id/status')
    updateStatus(
        @Param('id') id: string,
        @Body('statut') statut: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.tasksService.updateStatus(
            id,
            statut,
            user.id,
            user.role,
        );
    }

    /**
     * Supprimer une tâche
     */
    @Delete(':id')
    remove(
        @Param('id') id: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.tasksService.remove(
            id,
            user.id,
            user.role,
        );
    }
}