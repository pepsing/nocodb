import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { TenantContext } from '~/decorators/tenant-context.decorator';
import { GlobalGuard } from '~/guards/global/global.guard';
import { MetaApiLimiterGuard } from '~/guards/meta-api-limiter.guard';
import { NcContext } from '~/interface/config';
import { Acl } from '~/middlewares/extract-ids/extract-ids.middleware';
import { ProjectFoldersService } from '~/services/project-folders.service';

@Controller()
@UseGuards(MetaApiLimiterGuard, GlobalGuard)
export class ProjectFoldersController {
  constructor(private readonly projectFoldersService: ProjectFoldersService) {}

  @Get([
    '/api/v1/db/meta/projects/:baseId/folders',
    '/api/v2/meta/bases/:baseId/folders',
  ])
  @Acl('tableList')
  async folderList(
    @TenantContext() context: NcContext,
    @Param('baseId') baseId: string,
    @Query('sourceId') sourceId?: string,
  ) {
    return {
      list: await this.projectFoldersService.list(context, {
        baseId,
        sourceId,
      }),
    };
  }

  @Post([
    '/api/v1/db/meta/projects/:baseId/folders',
    '/api/v2/meta/bases/:baseId/folders',
  ])
  @HttpCode(200)
  @Acl('tableCreate')
  async folderCreate(
    @TenantContext() context: NcContext,
    @Param('baseId') baseId: string,
    @Body()
    body: {
      title: string;
      source_id?: string | null;
      fk_parent_id?: string | null;
      order?: number;
      description?: string | null;
    },
  ) {
    return this.projectFoldersService.create(context, {
      baseId,
      title: body.title,
      sourceId: body.source_id,
      parentId: body.fk_parent_id,
      order: body.order,
      description: body.description,
    });
  }

  @Patch([
    '/api/v1/db/meta/projects/:baseId/folders/:folderId',
    '/api/v2/meta/bases/:baseId/folders/:folderId',
  ])
  @Acl('tableUpdate')
  async folderUpdate(
    @TenantContext() context: NcContext,
    @Param('baseId') baseId: string,
    @Param('folderId') folderId: string,
    @Body()
    body: {
      title?: string;
      fk_parent_id?: string | null;
      order?: number;
      description?: string | null;
    },
  ) {
    return this.projectFoldersService.update(context, {
      baseId,
      folderId,
      title: body.title,
      parentId: body.fk_parent_id,
      order: body.order,
      description: body.description,
    });
  }

  @Delete([
    '/api/v1/db/meta/projects/:baseId/folders/:folderId',
    '/api/v2/meta/bases/:baseId/folders/:folderId',
  ])
  @Acl('tableDelete')
  async folderDelete(
    @TenantContext() context: NcContext,
    @Param('baseId') baseId: string,
    @Param('folderId') folderId: string,
    @Request() _req,
  ) {
    return this.projectFoldersService.delete(context, { baseId, folderId });
  }
}
