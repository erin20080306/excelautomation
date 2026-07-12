import type { Prisma, PrismaClient } from '@prisma/client';
import { REPORT_TYPES, reportTypeLabels, type ReportTypeKey } from '@excelmaster/shared';

const fields: Partial<Record<ReportTypeKey, Array<[string, string, string, string[]]>>> = {
  sales: [
    ['date', '日期', 'date', ['交易日期', '出貨日期', 'Date']], ['customer', '客戶', 'text', ['客戶名稱', '公司', 'Customer']],
    ['product', '商品', 'text', ['商品名稱', '品項', 'Product']], ['specification', '規格', 'text', ['型號', 'Spec']],
    ['quantity', '數量', 'decimal', ['出貨量', 'QTY', 'Qty']], ['unit_price', '單價', 'money', ['售價', 'Price']],
    ['amount', '金額', 'money', ['小計', 'Total', 'Amount']], ['salesperson', '業務', 'text', ['業務員', 'Sales']]
  ],
  purchase: [
    ['purchase_no', '採購單號', 'text', ['PO', 'P/O No']], ['supplier', '供應商', 'text', ['廠商', 'Vendor']],
    ['date', '日期', 'date', ['採購日期']], ['product', '商品', 'text', ['品項']], ['quantity', '數量', 'decimal', ['QTY']],
    ['unit_price', '單價', 'money', ['Price']], ['amount', '採購金額', 'money', ['金額', 'Total']]
  ],
  attendance: [
    ['employee_id', '員工編號', 'text', ['工號', 'Employee ID']], ['name', '姓名', 'text', ['員工姓名', 'Name']],
    ['date', '日期', 'date', ['出勤日']], ['shift', '班別', 'text', ['班次']], ['clock_in', '上班時間', 'datetime', ['簽到']],
    ['clock_out', '下班時間', 'datetime', ['簽退']], ['hours', '工時', 'decimal', ['時數']], ['overtime', '加班時數', 'decimal', ['OT']]
  ],
  inventory: [
    ['product_id', '商品編號', 'text', ['料號', 'SKU']], ['product', '商品名稱', 'text', ['品名', 'Product']],
    ['specification', '規格', 'text', ['型號']], ['warehouse', '倉庫', 'text', ['庫別']],
    ['quantity', '現有數量', 'decimal', ['庫存量', 'On Hand']], ['safety_stock', '安全庫存', 'decimal', ['最低庫存']],
    ['unit', '單位', 'text', ['UOM']]
  ],
  customer: [
    ['customer_id', '客戶編號', 'text', ['客編', 'Customer ID']], ['company', '公司名稱', 'text', ['客戶名稱', 'Company']],
    ['contact', '聯絡人', 'text', ['姓名', 'Contact']], ['phone', '電話', 'phone', ['手機', 'Tel']],
    ['email', 'Email', 'email', ['電子郵件', 'E-mail']], ['address', '地址', 'text', ['公司地址', 'Address']]
  ]
};

export async function bootstrapWorkspace(tx: Prisma.TransactionClient | PrismaClient, workspaceId: string): Promise<void> {
  const reportTypes = await tx.reportType.createManyAndReturn({
    data: REPORT_TYPES.map((key) => ({ workspaceId, key, name: reportTypeLabels[key], keywords: [] })),
    select: { id: true, key: true }
  });
  for (const reportType of reportTypes) {
    const key = reportType.key as ReportTypeKey;
    const schemaFields = fields[key];
    if (schemaFields) {
      await tx.dynamicSchema.create({
        data: {
          workspaceId, reportTypeId: reportType.id, name: `${reportTypeLabels[key]}標準欄位`,
          fields: {
            create: schemaFields.map(([fieldKey, name, type, aliases], position) => {
              const normalizedAliases = new Map<string, string>();
              for (const alias of aliases) {
                const normalized = alias.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
                if (!normalizedAliases.has(normalized)) normalizedAliases.set(normalized, alias);
              }
              return {
                key: fieldKey,
                name,
                type,
                position,
                aliases: { create: [...normalizedAliases].map(([normalized, alias]) => ({ alias, normalized })) }
              };
            })
          }
        }
      });
    }
  }
}
