import { nanoid } from 'nanoid';
import Noco from '~/Noco';
import { extractProps } from '~/helpers/extractProps';
import { NcContext } from '~/interface/config';
import { MetaTable } from '~/utils/globals';

const omitUndefined = <T extends Record<string, any>>(obj: T) => {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) {
      delete obj[key];
    }
  }
  return obj;
};

export default class ProjectFolder {
  id: string;
  fk_workspace_id?: string;
  base_id: string;
  source_id?: string | null;
  fk_parent_id?: string | null;
  title: string;
  description?: string | null;
  order?: number;
  created_at?: Date | string;
  updated_at?: Date | string;

  constructor(data: Partial<ProjectFolder>) {
    Object.assign(this, data);
  }

  static castType(folder: any) {
    return folder && new ProjectFolder(folder);
  }

  static async list(
    context: NcContext,
    {
      baseId,
      sourceId,
    }: {
      baseId: string;
      sourceId?: string | null;
    },
    ncMeta = Noco.ncMeta,
  ) {
    const qb = ncMeta
      .knex(MetaTable.PROJECT_FOLDERS)
      .where('fk_workspace_id', context.workspace_id)
      .where('base_id', baseId)
      .orderBy('order', 'asc')
      .orderBy('created_at', 'asc');

    if (sourceId !== undefined) {
      sourceId === null ? qb.whereNull('source_id') : qb.where('source_id', sourceId);
    }

    return (await qb).map((folder) => this.castType(folder));
  }

  static async get(context: NcContext, id: string, ncMeta = Noco.ncMeta) {
    return this.castType(
      await ncMeta.metaGet2(
        context.workspace_id,
        context.base_id,
        MetaTable.PROJECT_FOLDERS,
        id,
      ),
    );
  }

  static async insert(
    context: NcContext,
    folder: Partial<ProjectFolder>,
    ncMeta = Noco.ncMeta,
  ) {
    const insertObj = extractProps(folder, [
      'id',
      'source_id',
      'fk_parent_id',
      'title',
      'description',
      'order',
    ]);

    insertObj.id = folder.id || nanoid(20);

    const { id } = await ncMeta.metaInsert2(
      context.workspace_id,
      folder.base_id || context.base_id,
      MetaTable.PROJECT_FOLDERS,
      omitUndefined(insertObj),
    );

    return this.get(context, id, ncMeta);
  }

  static async update(
    context: NcContext,
    id: string,
    folder: Partial<ProjectFolder>,
    ncMeta = Noco.ncMeta,
  ) {
    const updateObj = extractProps(folder, [
      'source_id',
      'fk_parent_id',
      'title',
      'description',
      'order',
    ]);

    await ncMeta.metaUpdate(
      context.workspace_id,
      context.base_id,
      MetaTable.PROJECT_FOLDERS,
      omitUndefined(updateObj),
      id,
    );

    return this.get(context, id, ncMeta);
  }

  static async delete(context: NcContext, id: string, ncMeta = Noco.ncMeta) {
    return ncMeta.metaDelete(
      context.workspace_id,
      context.base_id,
      MetaTable.PROJECT_FOLDERS,
      id,
    );
  }
}
