// Phase 1 of the `--demo-data` seed (see the demo dataset plan): partners.
//
// Every name below is individually authored — no "Công ty ABC 01 / 02" — because
// a list a developer opens on day one should look like a real, if fictional,
// customer and vendor book, not a loop with a counter in it.

import { phoneVN, slug } from './util.ts'
import type { Call } from './util.ts'

type CompanySeed = { id: string; name: string; ref: string; role: 'customer' | 'supplier' }
type PersonSeed = { id: string; name: string }

const CUSTOMER_COMPANIES: CompanySeed[] = [
  {
    id: 'demo-partner-hoang-long',
    name: 'Công ty TNHH Thương mại Hoàng Long',
    ref: 'HOANGLONG',
    role: 'customer',
  },
  {
    id: 'demo-partner-dai-phat',
    name: 'Công ty Cổ phần Xây dựng Đại Phát',
    ref: 'DAIPHAT',
    role: 'customer',
  },
  {
    id: 'demo-partner-tan-tien',
    name: 'Công ty TNHH Sản xuất Bao bì Tân Tiến',
    ref: 'TANTIEN',
    role: 'customer',
  },
  {
    id: 'demo-partner-song-hong',
    name: 'Công ty Cổ phần Dệt may Sông Hồng',
    ref: 'SONGHONG',
    role: 'customer',
  },
  {
    id: 'demo-partner-viet-nhat',
    name: 'Công ty TNHH Cơ khí Chính xác Việt Nhật',
    ref: 'VIETNHAT',
    role: 'customer',
  },
  {
    id: 'demo-partner-mien-trung',
    name: 'Công ty Cổ phần Logistics Miền Trung',
    ref: 'MTLOGI',
    role: 'customer',
  },
  { id: 'demo-partner-an-binh', name: 'Công ty TNHH Thực phẩm An Bình', ref: 'ANBINH', role: 'customer' },
  {
    id: 'demo-partner-phuong-nam',
    name: 'Công ty Cổ phần Nội thất Phương Nam',
    ref: 'PHUONGNAM',
    role: 'customer',
  },
  { id: 'demo-partner-thai-son', name: 'Công ty TNHH Điện lạnh Thái Sơn', ref: 'THAISON', role: 'customer' },
  {
    id: 'demo-partner-bien-xanh',
    name: 'Công ty Cổ phần Du lịch Biển Xanh',
    ref: 'BIENXANH',
    role: 'customer',
  },
  { id: 'demo-partner-hong-ha', name: 'Công ty TNHH Vận tải Hồng Hà', ref: 'HONGHA', role: 'customer' },
  { id: 'demo-partner-tay-bac', name: 'Công ty Cổ phần Khoáng sản Tây Bắc', ref: 'TAYBAC', role: 'customer' },
  {
    id: 'demo-partner-minh-duc',
    name: 'Công ty TNHH Nhựa Kỹ thuật Minh Đức',
    ref: 'MINHDUC',
    role: 'customer',
  },
  { id: 'demo-partner-a-chau', name: 'Công ty Cổ phần In ấn Á Châu', ref: 'ACHAU', role: 'customer' },
  {
    id: 'demo-partner-hoa-binh',
    name: 'Công ty TNHH Thiết bị Y tế Hòa Bình',
    ref: 'HOABINH',
    role: 'customer',
  },
  {
    id: 'demo-partner-mat-troi-viet',
    name: 'Công ty Cổ phần Năng lượng Mặt Trời Việt',
    ref: 'MTVIET',
    role: 'customer',
  },
]

const SUPPLIER_COMPANIES: CompanySeed[] = [
  {
    id: 'demo-partner-vai-soi-bd',
    name: 'Công ty TNHH Vải sợi Bình Dương',
    ref: 'VSBINHDUONG',
    role: 'supplier',
  },
  {
    id: 'demo-partner-da-giay-dn',
    name: 'Công ty Cổ phần Da giày Đồng Nai',
    ref: 'DAGIAYDN',
    role: 'supplier',
  },
  {
    id: 'demo-partner-hoa-chat-la',
    name: 'Công ty TNHH Hóa chất Công nghiệp Long An',
    ref: 'HOACHATLA',
    role: 'supplier',
  },
  {
    id: 'demo-partner-thep-viet',
    name: 'Công ty Cổ phần Kim loại Thép Việt',
    ref: 'THEPVIET',
    role: 'supplier',
  },
  {
    id: 'demo-partner-carton-sg',
    name: 'Công ty TNHH Bao bì Carton Sài Gòn',
    ref: 'CARTONSG',
    role: 'supplier',
  },
  {
    id: 'demo-partner-cao-su-md',
    name: 'Công ty Cổ phần Cao su Miền Đông',
    ref: 'CAOSUMD',
    role: 'supplier',
  },
  {
    id: 'demo-partner-linh-kien-bn',
    name: 'Công ty TNHH Linh kiện Điện tử Bắc Ninh',
    ref: 'LINHKIENBN',
    role: 'supplier',
  },
]

const PEOPLE: PersonSeed[] = [
  { id: 'demo-partner-nguyen-van-an', name: 'Nguyễn Văn An' },
  { id: 'demo-partner-tran-thi-bich', name: 'Trần Thị Bích' },
  { id: 'demo-partner-le-hoang-nam', name: 'Lê Hoàng Nam' },
  { id: 'demo-partner-pham-cam-tu', name: 'Phạm Thị Cẩm Tú' },
  { id: 'demo-partner-hoang-minh-quan', name: 'Hoàng Minh Quân' },
  { id: 'demo-partner-vu-ngoc-ha', name: 'Vũ Thị Ngọc Hà' },
  { id: 'demo-partner-dang-van-phuc', name: 'Đặng Văn Phúc' },
  { id: 'demo-partner-bui-thanh-thao', name: 'Bùi Thị Thanh Thảo' },
  { id: 'demo-partner-ngo-quoc-huy', name: 'Ngô Quốc Huy' },
  { id: 'demo-partner-do-kim-oanh', name: 'Đỗ Thị Kim Oanh' },
  { id: 'demo-partner-ly-van-thanh', name: 'Lý Văn Thành' },
  { id: 'demo-partner-truong-mai-linh', name: 'Trương Thị Mai Linh' },
  { id: 'demo-partner-phan-van-duc', name: 'Phan Văn Đức' },
  { id: 'demo-partner-duong-hong-nhung', name: 'Dương Thị Hồng Nhung' },
]

export type PartnerSeedResult = { customerIds: string[]; supplierIds: string[]; allIds: string[] }

export async function seedPartners(call: Call): Promise<PartnerSeedResult> {
  const customerIds: string[] = []
  const supplierIds: string[] = []
  let index = 0
  for (const company of [...CUSTOMER_COMPANIES, ...SUPPLIER_COMPANIES]) {
    const domain = slug(company.name).split('-').slice(-1)[0]
    await call('partner.savePartner', {
      id: company.id,
      kind: 'company',
      name: company.name,
      ref: company.ref,
      email: `giaodich@${domain}.vn`,
      phone: phoneVN(index),
    })
    await call('partner.grantRole', {
      id: `${company.id}:${company.role}`,
      partnerId: company.id,
      role: company.role,
    })
    if (company.role === 'customer') customerIds.push(company.id)
    else supplierIds.push(company.id)
    index += 1
  }
  for (const person of PEOPLE) {
    await call('partner.savePartner', {
      id: person.id,
      kind: 'person',
      name: person.name,
      email: `${slug(person.name)}@gmail.com`,
      phone: phoneVN(index),
    })
    await call('partner.grantRole', { id: `${person.id}:customer`, partnerId: person.id, role: 'customer' })
    customerIds.push(person.id)
    index += 1
  }
  return { customerIds, supplierIds, allIds: [...customerIds, ...supplierIds] }
}
