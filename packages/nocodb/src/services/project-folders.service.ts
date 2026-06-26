import { Injectable } from '@nestjs/common';
import { NcError } from '~/helpers/catchError';
import { NcContext } from '~/interface/config';
import { Base, Model, ProjectFolder } from '~/models';
import Noco from '~/Noco';
import { MetaTable } from '~/utils/globals';

@Injectable()
export class ProjectFoldersService {
  async list(
    context: NcContext,
    param: {
      baseId: string;
      sourceId?: string;
    },
  ) {
    await this.ensureBase(context, param.baseId);
    return ProjectFolder.list(context, {
      baseId: param.baseId,
      sourceId: param.sourceId,
    });
  }

  async create(
    context: NcContext,
    param: {
      baseId: string;
      title: string;
      sourceId?: string | null;
      parentId?: string | null;
      order?: number;
      description?: string | null;
    },
  ) {
    const base = await this.ensureBase(context, param.baseId);
    const title = this.normalizeTitle(context, param.title);

    let sourceId = param.sourceId ?? base.sources?.[0]?.id ?? null;
    let parentId = param.parentId ?? null;

    if (parentId) {
      const parent = await this.ensureFolder(context, param.baseId, parentId);
      sourceId = parent.source_id ?? null;
      parentId = parent.id;
    } else if (sourceId) {
      this.ensureSource(context, base, sourceId);
    }

    const order =
      param.order ??
      (await Noco.ncMeta.metaGetNextOrder(MetaTable.PROJECT_FOLDERS, {
        fk_workspace_id: context.workspace_id,
        base_id: param.baseId,
        source_id: sourceId,
        fk_parent_id: parentId,
      }));

    return ProjectFolder.insert(context, {
      base_id: param.baseId,
      source_id: sourceId,
      fk_parent_id: parentId,
      title,
      description: param.description,
      order,
    });
  }

  async update(
    context: NcContext,
    param: {
      baseId: string;
      folderId: string;
      title?: string;
      parentId?: string | null;
      order?: number;
      description?: string | null;
    },
  ) {
    await this.ensureBase(context, param.baseId);
    const folder = await this.ensureFolder(context, param.baseId, param.folderId);

    const update: Partial<ProjectFolder> = {};

    if ('title' in param) {
      update.title = this.normalizeTitle(context, param.title);
    }

    if ('description' in param) {
      update.description = param.description;
    }

    if ('order' in param) {
      update.order = param.order;
    }

    if ('parentId' in param) {
      const parentId = param.parentId ?? null;

      if (parentId === folder.id) {
        NcError.get(context).invalidRequestBody('Folder cannot be moved into itself');
      }

      if (parentId) {
        const parent = await this.ensureFolder(context, param.baseId, parentId);
        await this.ensureNoCycle(context, folder.id, parent.id);
        update.fk_parent_id = parent.id;
        update.source_id = parent.source_id ?? null;
      } else {
        update.fk_parent_id = null;
      }
    }

    return ProjectFolder.update(context, folder.id, update);
  }

  async delete(
    context: NcContext,
    param: {
      baseId: string;
      folderId: string;
    },
  ) {
    const folder = await this.ensureFolder(context, param.baseId, param.folderId);

    const [childFolder, childTable] = await Promise.all([
      Noco.ncMeta
        .knex(MetaTable.PROJECT_FOLDERS)
        .where('fk_workspace_id', context.workspace_id)
        .where('base_id', param.baseId)
        .where('fk_parent_id', folder.id)
        .first(),
      Noco.ncMeta
        .knex(MetaTable.MODELS)
        .where('fk_workspace_id', context.workspace_id)
        .where('base_id', param.baseId)
        .where('fk_folder_id', folder.id)
        .where((qb) => qb.whereNull('deleted').orWhere('deleted', false))
        .first(),
    ]);

    if (childFolder || childTable) {
      NcError.get(context).invalidRequestBody('Folder must be empty before deletion');
    }

    await ProjectFolder.delete(context, folder.id);
    return { msg: 'The folder has been deleted successfully' };
  }

  async validateTableFolder(
    context: NcContext,
    param: {
      baseId: string;
      table: Model;
      folderId?: string | null;
    },
  ) {
    if (!param.folderId) return null;

    const folder = await this.ensureFolder(context, param.baseId, param.folderId);
    if (folder.source_id && folder.source_id !== param.table.source_id) {
      NcError.get(context).invalidRequestBody('Folder and table must belong to the same data source');
    }
    return folder;
  }

  async validateFolderForSource(
    context: NcContext,
    param: {
      baseId: string;
      sourceId?: string | null;
      folderId?: string | null;
    },
  ) {
    if (!param.folderId) return null;

    const folder = await this.ensureFolder(context, param.baseId, param.folderId);
    if (folder.source_id && param.sourceId && folder.source_id !== param.sourceId) {
      NcError.get(context).invalidRequestBody('Folder and table must belong to the same data source');
    }
    return folder;
  }

  private async ensureBase(context: NcContext, baseId: string) {
    const base = await Base.getWithInfo(context, baseId);
    if (!base) {
      NcError.get(context).invalidRequestBody('Base not found');
    }
    return base;
  }

  private ensureSource(context: NcContext, base: Base, sourceId: string) {
    if (!base.sources?.some((source) => source.id === sourceId)) {
      NcError.get(context).invalidRequestBody('Source not found in base');
    }
  }

  private async ensureFolder(context: NcContext, baseId: string, folderId: string) {
    const folder = await ProjectFolder.get(context, folderId);
    if (!folder || folder.base_id !== baseId) {
      NcError.get(context).invalidRequestBody('Folder not found');
    }
    return folder;
  }

  private async ensureNoCycle(context: NcContext, folderId: string, candidateParentId: string) {
    let cursor = await ProjectFolder.get(context, candidateParentId);

    while (cursor) {
      if (cursor.id === folderId) {
        NcError.get(context).invalidRequestBody('Folder cannot be moved into its descendant');
      }

      if (!cursor.fk_parent_id) return;
      cursor = await ProjectFolder.get(context, cursor.fk_parent_id);
    }
  }

  private normalizeTitle(context: NcContext, title?: string) {
    const normalized = title?.trim();
    if (!normalized) {
      NcError.get(context).invalidRequestBody('Missing folder title');
    }
    if (normalized.length > 255) {
      NcError.get(context).invalidRequestBody('Folder title exceeds 255 characters');
    }
    return normalized as string;
  }
}
