import { nanoid } from 'nanoid';
import Noco from '~/Noco';
import { extractProps } from '~/helpers/extractProps';
import { MetaTable, RootScopes } from '~/utils/globals';
import { prepareForDb } from '~/utils/modelUtils';

const omitUndefined = <T extends Record<string, any>>(obj: T) => {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) {
      delete obj[key];
    }
  }
  return obj;
};

export default class CorporateIdentityMapping {
  id: string;
  provider: string;
  subject?: string;
  employee_code?: string;
  email?: string;
  display_name?: string;
  department?: string;
  fk_user_id?: string;
  org_roles?: string;
  workspace_roles?: string;
  base_roles?: string;
  is_super_admin?: boolean;
  is_disabled?: boolean;
  auto_provisioned?: boolean;
  last_claims?: string;
  last_login_at?: Date | string;
  created_at?: Date | string;
  updated_at?: Date | string;

  constructor(data: Partial<CorporateIdentityMapping>) {
    Object.assign(this, data);
  }

  static castType(mapping: any) {
    return mapping && new CorporateIdentityMapping(mapping);
  }

  static async get(id: string, ncMeta = Noco.ncMeta) {
    return this.castType(
      await ncMeta.metaGet2(
        RootScopes.ROOT,
        RootScopes.ROOT,
        MetaTable.CORP_IDENTITY_MAPPINGS,
        id,
      ),
    );
  }

  static async findForLogin(
    {
      provider,
      subject,
      employee_code,
    }: {
      provider: string;
      subject?: string | null;
      employee_code?: string | null;
    },
    ncMeta = Noco.ncMeta,
  ) {
    const qb = ncMeta.knex(MetaTable.CORP_IDENTITY_MAPPINGS).where({
      provider,
    });

    qb.andWhere(function () {
      if (subject) {
        this.orWhere('subject', subject);
      }
      if (employee_code) {
        this.orWhere('employee_code', employee_code);
      }
    });

    const mapping = await qb.orderBy('updated_at', 'desc').first();
    return this.castType(mapping);
  }

  static async insert(
    mapping: Partial<CorporateIdentityMapping>,
    ncMeta = Noco.ncMeta,
  ) {
    const insertObj = extractProps(mapping, [
      'provider',
      'subject',
      'employee_code',
      'email',
      'display_name',
      'department',
      'fk_user_id',
      'org_roles',
      'workspace_roles',
      'base_roles',
      'is_super_admin',
      'is_disabled',
      'auto_provisioned',
      'last_claims',
      'last_login_at',
    ]);

    insertObj.id = mapping.id || nanoid(20);

    const { id } = await ncMeta.metaInsert2(
      RootScopes.ROOT,
      RootScopes.ROOT,
      MetaTable.CORP_IDENTITY_MAPPINGS,
      prepareForDb(omitUndefined(insertObj)),
    );

    return this.get(id, ncMeta);
  }

  static async update(
    id: string,
    mapping: Partial<CorporateIdentityMapping>,
    ncMeta = Noco.ncMeta,
  ) {
    const updateObj = extractProps(mapping, [
      'subject',
      'employee_code',
      'email',
      'display_name',
      'department',
      'fk_user_id',
      'org_roles',
      'workspace_roles',
      'base_roles',
      'is_super_admin',
      'is_disabled',
      'auto_provisioned',
      'last_claims',
      'last_login_at',
    ]);

    await ncMeta.metaUpdate(
      RootScopes.ROOT,
      RootScopes.ROOT,
      MetaTable.CORP_IDENTITY_MAPPINGS,
      prepareForDb(omitUndefined(updateObj)),
      id,
    );

    return this.get(id, ncMeta);
  }
}
