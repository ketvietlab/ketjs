// Phase 1 of the `--demo-data` seed: the product catalog.
//
// 40 individually named items — a workwear/PPE/corporate-gifts catalog, the same
// business the `tpl-review` e2e fixture uses — across four real categories, not
// a `Sản phẩm mẫu 01..40` loop. One flagship item (the jacket) gets attributes
// and generated variants, exactly like the proven e2e fixture; the rest are
// simple templates, which is how most of a real catalog actually looks.

import type { Call } from './util.ts'

type Row = Record<string, unknown>

const CATEGORY = {
  uniform: 'demo-cat-uniform',
  ppe: 'demo-cat-ppe',
  tools: 'demo-cat-tools',
  gifts: 'demo-cat-gifts',
} as const

const UOM = {
  unit: 'demo-uom-unit',
  set: 'demo-uom-set',
  pair: 'demo-uom-pair',
  box: 'demo-uom-box',
} as const

const BRAND = {
  ketviet: 'demo-brand-ketviet',
  safepro: 'demo-brand-safepro',
} as const

type Category = (typeof CATEGORY)[keyof typeof CATEGORY]
type Uom = (typeof UOM)[keyof typeof UOM]
type Brand = (typeof BRAND)[keyof typeof BRAND]

type ProductSeed = {
  id: string
  name: string
  category: Category
  uom: Uom
  brand?: Brand
  listPrice: string
  cost: string
  defaultCode: string
  description: string
  tracking?: 'none' | 'lot'
}

const PRODUCTS: ProductSeed[] = [
  {
    id: 'demo-product-polo',
    name: 'Áo polo đồng phục văn phòng',
    category: CATEGORY.uniform,
    uom: UOM.unit,
    brand: BRAND.ketviet,
    listPrice: '185000',
    cost: '92000',
    defaultCode: 'UNI-POLO',
    description: 'Áo polo cotton pha, thêu logo theo yêu cầu, dùng cho khối văn phòng và lễ tân.',
  },
  {
    id: 'demo-product-kaki',
    name: 'Quần kaki công sở nam',
    category: CATEGORY.uniform,
    uom: UOM.unit,
    brand: BRAND.ketviet,
    listPrice: '245000',
    cost: '128000',
    defaultCode: 'UNI-KAKI',
    description: 'Quần kaki co giãn nhẹ, form slim fit, phù hợp môi trường văn phòng.',
  },
  {
    id: 'demo-product-somi',
    name: 'Áo sơ mi đồng phục lễ tân',
    category: CATEGORY.uniform,
    uom: UOM.unit,
    brand: BRAND.ketviet,
    listPrice: '210000',
    cost: '110000',
    defaultCode: 'UNI-SOMI',
    description: 'Áo sơ mi vải kate không nhăn, dành cho bộ phận lễ tân và chăm sóc khách hàng.',
  },
  {
    id: 'demo-product-gile-canh-bao',
    name: 'Áo gile phản quang công trường',
    category: CATEGORY.uniform,
    uom: UOM.unit,
    brand: BRAND.safepro,
    listPrice: '95000',
    cost: '48000',
    defaultCode: 'UNI-GILE',
    description: 'Gile lưới thoáng khí, dải phản quang 3M, dùng ngoài công trường và kho vận.',
  },
  {
    id: 'demo-product-non-bao-ve',
    name: 'Nón kết đồng phục bảo vệ',
    category: CATEGORY.uniform,
    uom: UOM.unit,
    brand: BRAND.ketviet,
    listPrice: '65000',
    cost: '30000',
    defaultCode: 'UNI-NON',
    description: 'Nón kết vải kaki, thêu logo, dùng cho lực lượng bảo vệ và tiếp tân.',
  },
  {
    id: 'demo-product-ao-su-kien',
    name: 'Áo thun đồng phục sự kiện',
    category: CATEGORY.uniform,
    uom: UOM.unit,
    brand: BRAND.ketviet,
    listPrice: '75000',
    cost: '35000',
    defaultCode: 'UNI-EVENT',
    description: 'Áo thun cotton 100%, in chuyển nhiệt, đặt theo lô cho sự kiện và hội chợ.',
  },
  {
    id: 'demo-product-khan-quang',
    name: 'Khăn quàng cổ đồng phục',
    category: CATEGORY.uniform,
    uom: UOM.unit,
    brand: BRAND.ketviet,
    listPrice: '45000',
    cost: '18000',
    defaultCode: 'UNI-KHAN',
    description: 'Khăn lụa in họa tiết thương hiệu, phối cùng đồng phục lễ tân.',
  },
  {
    id: 'demo-product-mu-bao-ho',
    name: 'Mũ bảo hộ công nghiệp',
    category: CATEGORY.ppe,
    uom: UOM.unit,
    brand: BRAND.safepro,
    listPrice: '120000',
    cost: '62000',
    defaultCode: 'PPE-MU',
    description: 'Mũ nhựa ABS chịu lực, quai cài 4 điểm, đạt tiêu chuẩn an toàn công trường.',
  },
  {
    id: 'demo-product-giay-chong-dinh',
    name: 'Giày bảo hộ chống đinh',
    category: CATEGORY.ppe,
    uom: UOM.pair,
    brand: BRAND.safepro,
    listPrice: '350000',
    cost: '210000',
    defaultCode: 'PPE-GIAY-DINH',
    description: 'Đế chống đinh, mũi thép, da bò thật, dùng cho công nhân cơ khí và xây dựng.',
    tracking: 'lot',
  },
  {
    id: 'demo-product-ung-hoa-chat',
    name: 'Ủng cao su chống hóa chất',
    category: CATEGORY.ppe,
    uom: UOM.pair,
    brand: BRAND.safepro,
    listPrice: '210000',
    cost: '125000',
    defaultCode: 'PPE-UNG-HC',
    description: 'Cao su tổng hợp kháng axit và dung môi, dùng trong nhà máy hóa chất.',
  },
  {
    id: 'demo-product-gang-tay-han',
    name: 'Găng tay da hàn',
    category: CATEGORY.ppe,
    uom: UOM.pair,
    brand: BRAND.safepro,
    listPrice: '85000',
    cost: '42000',
    defaultCode: 'PPE-GT-HAN',
    description: 'Da bò dày 1.2mm chịu nhiệt, lót vải cách nhiệt, dùng cho thợ hàn.',
  },
  {
    id: 'demo-product-gang-tay-cat',
    name: 'Găng tay chống cắt cấp độ 5',
    category: CATEGORY.ppe,
    uom: UOM.pair,
    brand: BRAND.safepro,
    listPrice: '95000',
    cost: '50000',
    defaultCode: 'PPE-GT-CAT',
    description: 'Sợi HPPE đan kháng cắt, phủ nitrile lòng bàn tay, dùng khi thao tác kim loại tấm.',
  },
  {
    id: 'demo-product-kinh-bui',
    name: 'Kính bảo hộ chống bụi',
    category: CATEGORY.ppe,
    uom: UOM.unit,
    brand: BRAND.safepro,
    listPrice: '45000',
    cost: '20000',
    defaultCode: 'PPE-KINH',
    description: 'Tròng chống trầy chống mờ sương, gọng ôm mặt, chống bụi và bắn tia.',
  },
  {
    id: 'demo-product-khau-trang',
    name: 'Khẩu trang than hoạt tính',
    category: CATEGORY.ppe,
    uom: UOM.box,
    brand: BRAND.safepro,
    listPrice: '120000',
    cost: '65000',
    defaultCode: 'PPE-KT',
    description: 'Hộp 50 chiếc, lớp than hoạt tính lọc bụi mịn và mùi hóa chất nhẹ.',
  },
  {
    id: 'demo-product-nut-tai',
    name: 'Nút tai chống ồn',
    category: CATEGORY.ppe,
    uom: UOM.box,
    brand: BRAND.safepro,
    listPrice: '55000',
    cost: '25000',
    defaultCode: 'PPE-NT',
    description: 'Hộp 100 cặp, xốp PU giảm ồn 32dB, dùng trong xưởng máy có tiếng ồn lớn.',
  },
  {
    id: 'demo-product-day-dai',
    name: 'Dây đai an toàn toàn thân',
    category: CATEGORY.ppe,
    uom: UOM.unit,
    brand: BRAND.safepro,
    listPrice: '680000',
    cost: '410000',
    defaultCode: 'PPE-DAI',
    description: 'Đai toàn thân 5 điểm móc, kèm dây hãm rơi, dùng khi làm việc trên cao.',
    tracking: 'lot',
  },
  {
    id: 'demo-product-tap-de',
    name: 'Tạp dề da chống cháy',
    category: CATEGORY.ppe,
    uom: UOM.unit,
    brand: BRAND.safepro,
    listPrice: '275000',
    cost: '160000',
    defaultCode: 'PPE-TAPDE',
    description: 'Da thuộc chịu nhiệt, dùng khi hàn cắt hoặc thao tác gần nguồn lửa.',
  },
  {
    id: 'demo-product-ao-mua',
    name: 'Áo mưa bộ đi mưa công trường',
    category: CATEGORY.ppe,
    uom: UOM.set,
    brand: BRAND.safepro,
    listPrice: '165000',
    cost: '85000',
    defaultCode: 'PPE-MUA',
    description: 'Bộ áo quần liền, vải PVC không thấm nước, dùng khi thi công trời mưa.',
  },
  {
    id: 'demo-product-ao-gio',
    name: 'Áo khoác gió chống thấm',
    category: CATEGORY.ppe,
    uom: UOM.unit,
    brand: BRAND.safepro,
    listPrice: '320000',
    cost: '190000',
    defaultCode: 'PPE-GIO',
    description: 'Vải dù 2 lớp cản gió, có mũ trùm, dùng ngoài trời trong mùa lạnh.',
  },
  {
    id: 'demo-product-quan-yem',
    name: 'Quần yếm bảo hộ',
    category: CATEGORY.ppe,
    uom: UOM.unit,
    brand: BRAND.safepro,
    listPrice: '285000',
    cost: '165000',
    defaultCode: 'PPE-YEM',
    description: 'Vải kaki dày, nhiều túi công cụ, dùng cho thợ cơ khí và bảo trì.',
  },
  {
    id: 'demo-product-non-bao-hiem',
    name: 'Nón bảo hiểm công trường',
    category: CATEGORY.ppe,
    uom: UOM.unit,
    brand: BRAND.safepro,
    listPrice: '145000',
    cost: '80000',
    defaultCode: 'PPE-NONBH',
    description: 'Vỏ nhựa ABS, kính chắn gió gắn kèm, dùng khi vận hành xe nâng và máy công trình.',
  },
  {
    id: 'demo-product-yem-giao-thong',
    name: 'Yếm phản quang giao thông',
    category: CATEGORY.ppe,
    uom: UOM.unit,
    brand: BRAND.safepro,
    listPrice: '68000',
    cost: '32000',
    defaultCode: 'PPE-YEMGT',
    description: 'Vải lưới nhẹ, hai dải phản quang chéo, dùng khi điều tiết giao thông công trường.',
  },
  {
    id: 'demo-product-gang-tay-cach-dien',
    name: 'Găng tay cách điện hạ thế',
    category: CATEGORY.ppe,
    uom: UOM.pair,
    brand: BRAND.safepro,
    listPrice: '195000',
    cost: '115000',
    defaultCode: 'PPE-GTCD',
    description: 'Cao su cách điện đạt chuẩn 1000V, dùng cho thợ điện hạ thế.',
    tracking: 'lot',
  },
  {
    id: 'demo-product-ung-mui-thep',
    name: 'Ủng bảo hộ mũi thép',
    category: CATEGORY.ppe,
    uom: UOM.pair,
    brand: BRAND.safepro,
    listPrice: '380000',
    cost: '230000',
    defaultCode: 'PPE-UNGTHEP',
    description: 'Ủng cao su nguyên khối, mũi thép chịu lực 200kg, dùng ở khu vực ẩm ướt.',
  },
  {
    id: 'demo-product-ao-lot-giu-nhiet',
    name: 'Áo lót giữ nhiệt mùa đông',
    category: CATEGORY.ppe,
    uom: UOM.unit,
    brand: BRAND.safepro,
    listPrice: '135000',
    cost: '72000',
    defaultCode: 'PPE-AOLOT',
    description: 'Vải nỉ giữ nhiệt, mặc trong lớp đồng phục khi làm việc ngoài trời lạnh.',
  },
  {
    id: 'demo-product-balo',
    name: 'Balo đựng dụng cụ đa năng',
    category: CATEGORY.tools,
    uom: UOM.unit,
    listPrice: '420000',
    cost: '250000',
    defaultCode: 'TOOL-BALO',
    description: 'Vải bạt chống thấm, nhiều ngăn chia dụng cụ, quai đeo gia cố.',
  },
  {
    id: 'demo-product-tui-hong',
    name: 'Túi đeo hông thợ điện',
    category: CATEGORY.tools,
    uom: UOM.unit,
    listPrice: '195000',
    cost: '110000',
    defaultCode: 'TOOL-TUIHONG',
    description: 'Túi da công nghiệp đeo thắt lưng, ngăn riêng cho kìm và tua vít.',
  },
  {
    id: 'demo-product-bang-do',
    name: 'Băng đô thấm mồ hôi',
    category: CATEGORY.tools,
    uom: UOM.unit,
    listPrice: '35000',
    cost: '14000',
    defaultCode: 'TOOL-BANGDO',
    description: 'Vải cotton co giãn, dùng dưới mũ bảo hộ khi làm việc ngoài trời nắng nóng.',
  },
  {
    id: 'demo-product-vo-lao-dong',
    name: 'Vớ lao động cotton',
    category: CATEGORY.tools,
    uom: UOM.pair,
    listPrice: '25000',
    cost: '10000',
    defaultCode: 'TOOL-VO',
    description: 'Cotton dày, cổ cao, đi cùng giày bảo hộ trong ca làm việc dài.',
  },
  {
    id: 'demo-product-that-lung',
    name: 'Thắt lưng nịt bụng nâng đỡ',
    category: CATEGORY.tools,
    uom: UOM.unit,
    listPrice: '165000',
    cost: '90000',
    defaultCode: 'TOOL-THATLUNG',
    description: 'Đai lưng hỗ trợ cột sống khi nâng vật nặng, có thanh nẹp điều chỉnh.',
  },
  {
    id: 'demo-product-den-pin',
    name: 'Đèn pin đội đầu công trường',
    category: CATEGORY.tools,
    uom: UOM.unit,
    listPrice: '145000',
    cost: '78000',
    defaultCode: 'TOOL-DENPIN',
    description: 'LED sạc USB, gắn được lên mũ bảo hộ, chiếu sáng khi làm việc trong hầm/kho.',
  },
  {
    id: 'demo-product-so-cuu',
    name: 'Hộp sơ cứu cá nhân',
    category: CATEGORY.tools,
    uom: UOM.box,
    listPrice: '195000',
    cost: '110000',
    defaultCode: 'TOOL-SOCUU',
    description: 'Hộp nhựa chống nước, đủ băng gạc và thuốc sát trùng cơ bản theo quy định an toàn.',
  },
  {
    id: 'demo-product-vali-dung-cu',
    name: 'Vali đựng dụng cụ kỹ thuật',
    category: CATEGORY.tools,
    uom: UOM.unit,
    listPrice: '890000',
    cost: '540000',
    defaultCode: 'TOOL-VALI',
    description: 'Vỏ nhựa ABS chống va đập, khay chia tầng, dùng cho kỹ thuật viên bảo trì.',
  },
  {
    id: 'demo-product-may-do-nhiet',
    name: 'Máy đo nhiệt độ cầm tay',
    category: CATEGORY.tools,
    uom: UOM.unit,
    listPrice: '750000',
    cost: '470000',
    defaultCode: 'TOOL-NHIETKE',
    description: 'Đo nhiệt độ hồng ngoại không tiếp xúc, dùng kiểm tra thiết bị và an toàn lao động.',
  },
  {
    id: 'demo-product-binh-nuoc',
    name: 'Bình nước giữ nhiệt công trường',
    category: CATEGORY.gifts,
    uom: UOM.unit,
    brand: BRAND.ketviet,
    listPrice: '165000',
    cost: '90000',
    defaultCode: 'GIFT-BINH',
    description: 'Inox 2 lớp giữ nhiệt 12 giờ, khắc logo, dùng làm quà tặng đối tác.',
  },
  {
    id: 'demo-product-o-du',
    name: 'Ô cầm tay logo công ty',
    category: CATEGORY.gifts,
    uom: UOM.unit,
    brand: BRAND.ketviet,
    listPrice: '95000',
    cost: '48000',
    defaultCode: 'GIFT-ODU',
    description: 'Khung thép chống lật gió, in logo thương hiệu, tặng khách hàng dịp lễ.',
  },
  {
    id: 'demo-product-so-tay',
    name: 'Sổ tay ghi chép công trường',
    category: CATEGORY.gifts,
    uom: UOM.unit,
    brand: BRAND.ketviet,
    listPrice: '35000',
    cost: '15000',
    defaultCode: 'GIFT-SOTAY',
    description: 'Bìa da công nghiệp, ruột giấy chống thấm nhẹ, in logo theo yêu cầu.',
  },
  {
    id: 'demo-product-but-bi',
    name: 'Bút bi khắc logo doanh nghiệp',
    category: CATEGORY.gifts,
    uom: UOM.unit,
    brand: BRAND.ketviet,
    listPrice: '15000',
    cost: '6000',
    defaultCode: 'GIFT-BUTBI',
    description: 'Thân kim loại, khắc laser tên thương hiệu, đặt theo lô cho sự kiện.',
  },
  {
    id: 'demo-product-the-nhan-vien',
    name: 'Thẻ đeo nhân viên có dây',
    category: CATEGORY.gifts,
    uom: UOM.unit,
    brand: BRAND.ketviet,
    listPrice: '25000',
    cost: '10000',
    defaultCode: 'GIFT-THE',
    description: 'Vỏ nhựa cứng kèm dây đeo in logo, dùng cho nhân sự mới và khách tham quan.',
  },
]

const ATTRIBUTES = {
  color: {
    id: 'demo-attr-color',
    name: 'Màu sắc',
    values: [
      { id: 'demo-attr-color-blue', name: 'Xanh nghiệp vụ' },
      { id: 'demo-attr-color-orange', name: 'Cam cảnh báo' },
    ],
  },
  size: {
    id: 'demo-attr-size',
    name: 'Kích thước',
    values: [
      { id: 'demo-attr-size-s', name: 'S' },
      { id: 'demo-attr-size-m', name: 'M' },
      { id: 'demo-attr-size-l', name: 'L' },
      { id: 'demo-attr-size-xl', name: 'XL' },
    ],
  },
}

/** What a sale/purchase line needs: a sellable product id, its own unit, and a reference price. */
export type CatalogLine = {
  templateId: string
  productId: string
  uomId: Uom
  listPrice: string
  cost: string
}

export type ProductSeedResult = {
  templateIds: string[]
  defaultProductId: (templateId: string) => string
  /** Every simple (non-flagship) product, in catalog order — sale/purchase pick lines from this. */
  catalog: CatalogLine[]
}

export async function seedProducts(call: Call): Promise<ProductSeedResult> {
  await call('uom.saveUnit', { id: UOM.unit, name: 'Cái', relativeFactor: '1', sequence: 10 })
  await call('uom.saveUnit', { id: UOM.set, name: 'Bộ', relativeFactor: '1', sequence: 20 })
  await call('uom.saveUnit', { id: UOM.pair, name: 'Đôi', relativeFactor: '1', sequence: 30 })
  await call('uom.saveUnit', { id: UOM.box, name: 'Hộp', relativeFactor: '1', sequence: 40 })

  await call('product.saveCategory', { id: CATEGORY.uniform, name: 'Đồng phục vận hành' })
  await call('product.saveCategory', { id: CATEGORY.ppe, name: 'Bảo hộ lao động' })
  await call('product.saveCategory', { id: CATEGORY.tools, name: 'Phụ kiện & dụng cụ' })
  await call('product.saveCategory', { id: CATEGORY.gifts, name: 'Quà tặng doanh nghiệp' })

  await call('product.saveBrand', { id: BRAND.ketviet, name: 'Kết Việt' })
  await call('product.saveBrand', { id: BRAND.safepro, name: 'SafePro' })

  // The flagship item: attributes + generated variants, same shape as the
  // proven `tpl-review` e2e fixture, so the record-modal's Variants tab has
  // something real to page through as well as the template list.
  const flagshipId = 'demo-product-ao-khoac-van-hanh'
  await call('product.saveTemplate', {
    id: flagshipId,
    name: 'Áo khoác vận hành Kết Việt',
    type: 'goods',
    categoryId: CATEGORY.uniform,
    brandId: BRAND.ketviet,
    uomId: UOM.set,
    origin: 'Việt Nam',
    description: 'Áo khoác đồng phục hai lớp, chống gió nhẹ, dùng cho đội vận hành ngoài hiện trường.',
    listPrice: '890000',
    saleOk: true,
    purchaseOk: true,
    defaultCode: 'UNI-JACKET',
  })
  await call('product.saveAttribute', {
    id: ATTRIBUTES.color.id,
    name: ATTRIBUTES.color.name,
    sequence: 10,
    displayType: 'pills',
    createVariant: 'always',
  })
  for (const [i, value] of ATTRIBUTES.color.values.entries())
    await call('product.saveAttributeValue', {
      id: value.id,
      attributeId: ATTRIBUTES.color.id,
      name: value.name,
      sequence: (i + 1) * 10,
    })
  await call('product.saveAttribute', {
    id: ATTRIBUTES.size.id,
    name: ATTRIBUTES.size.name,
    sequence: 20,
    displayType: 'pills',
    createVariant: 'always',
  })
  for (const [i, value] of ATTRIBUTES.size.values.entries())
    await call('product.saveAttributeValue', {
      id: value.id,
      attributeId: ATTRIBUTES.size.id,
      name: value.name,
      sequence: (i + 1) * 10,
    })
  await call('product.saveAttributeLine', {
    id: `${flagshipId}:color`,
    templateId: flagshipId,
    attributeId: ATTRIBUTES.color.id,
    valueIds: ATTRIBUTES.color.values.map((v) => v.id),
  })
  await call('product.saveAttributeLine', {
    id: `${flagshipId}:size`,
    templateId: flagshipId,
    attributeId: ATTRIBUTES.size.id,
    valueIds: ATTRIBUTES.size.values.map((v) => v.id),
  })
  await call('product.generateVariants', { templateId: flagshipId })
  await call('stock.configureProduct', { templateId: flagshipId, isStorable: true, tracking: 'none' })
  const flagshipVariants = (await call('product.listVariants', {
    templateId: flagshipId,
  })) as unknown as Row[]
  for (const variant of Array.isArray(flagshipVariants) ? flagshipVariants : []) {
    await call('product.setCost', { productId: String(variant.id), standardPrice: '480000' })
  }

  const templateIds = [flagshipId]
  const catalog: CatalogLine[] = []
  for (const product of PRODUCTS) {
    await call('product.saveTemplate', {
      id: product.id,
      name: product.name,
      type: 'goods',
      categoryId: product.category,
      uomId: product.uom,
      description: product.description,
      listPrice: product.listPrice,
      saleOk: true,
      purchaseOk: true,
      defaultCode: product.defaultCode,
      ...(product.brand ? { brandId: product.brand } : {}),
    })
    await call('stock.configureProduct', {
      templateId: product.id,
      isStorable: true,
      tracking: product.tracking ?? 'none',
    })
    await call('product.setCost', { productId: `${product.id}:default`, standardPrice: product.cost })
    templateIds.push(product.id)
    catalog.push({
      templateId: product.id,
      productId: `${product.id}:default`,
      uomId: product.uom,
      listPrice: product.listPrice,
      cost: product.cost,
    })
  }

  return { templateIds, defaultProductId: (templateId) => `${templateId}:default`, catalog }
}
