import { createHash } from 'node:crypto'

export type Tt99Account = {
  code: string
  name: string
  nameEn: string
  accountType: string
  reconcile: boolean
}

/**
 * Vietnam's statutory chart effective for financial years beginning on or after
 * 2026-01-01. Codes and Vietnamese names follow Appendix II of Circular
 * 99/2025/TT-BTC. A published leaf-account mapping is used as an implementation
 * cross-check; KetSuite deliberately corrects 411121 to a liability account.
 */
export const TT99_ACCOUNTS: readonly Tt99Account[] = [
  {
    code: '111',
    name: 'Tiền mặt',
    nameEn: 'Cash',
    accountType: 'asset_cash',
    reconcile: false,
  },
  {
    code: '112',
    name: 'Tiền gửi không kỳ hạn',
    nameEn: 'Demand Deposit',
    accountType: 'asset_cash',
    reconcile: false,
  },
  {
    code: '1121',
    name: 'Tài khoản tạm thời ngân hàng',
    nameEn: 'Bank Suspense Account',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '113',
    name: 'Tiền đang chuyển',
    nameEn: 'Money in transit',
    accountType: 'asset_cash',
    reconcile: false,
  },
  {
    code: '1131',
    name: 'Biên lai chưa thanh toán',
    nameEn: 'Outstanding Receipts',
    accountType: 'asset_current',
    reconcile: true,
  },
  {
    code: '1132',
    name: 'Khoản chi chưa thanh toán',
    nameEn: 'Outstanding Payments',
    accountType: 'asset_current',
    reconcile: true,
  },
  {
    code: '121',
    name: 'Chứng khoán kinh doanh',
    nameEn: 'Trading Securities',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '12811',
    name: 'Tiền gửi có kỳ hạn - dưới 3 tháng',
    nameEn: 'Time deposits - less than 3 months',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '12812',
    name: 'Tiền gửi có kỳ hạn - 3-12 tháng',
    nameEn: 'Time deposits - 3-12 months',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '12813',
    name: 'Tiền gửi có kỳ hạn - dài hạn',
    nameEn: 'Time deposits - long term',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '12822',
    name: 'Trái phiếu - 3-12 tháng',
    nameEn: 'Bonds - 3-12 months',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '12823',
    name: 'Trái phiếu - dài hạn',
    nameEn: 'Bonds - long term',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '12831',
    name: 'Cho vay - ngắn hạn',
    nameEn: 'Loans - short term',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '12832',
    name: 'Cho vay - dài hạn',
    nameEn: 'Loans - long term',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '12881',
    name: 'Các khoản đầu tư khác nắm giữ đến ngày đáo hạn - dưới 3 tháng',
    nameEn: 'Other investments held to maturity - less than 3 months',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '12882',
    name: 'Các khoản đầu tư khác nắm giữ đến ngày đáo hạn - 3-12 tháng',
    nameEn: 'Other investments held to maturity - 3-12 months',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '12883',
    name: 'Các khoản đầu tư khác nắm giữ đến ngày đáo hạn - dài hạn',
    nameEn: 'Other investments held to maturity - long term',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '1311',
    name: 'Phải thu của khách hàng - ngắn hạn',
    nameEn: 'Trade receivables - short term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '1312',
    name: 'Phải thu của khách hàng - dài hạn',
    nameEn: 'Trade receivables - long term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '1331',
    name: 'Thuế GTGT HHDV mua vào',
    nameEn: 'Deductible VAT of goods and services',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '1332',
    name: 'Thuế GTGT được khấu trừ của tài sản cố định',
    nameEn: 'Deductible VAT of fixed assets',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '1361',
    name: 'Vốn kinh doanh ở các đơn vị trực thuộc',
    nameEn: 'Working capital provided to sub-units',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '13621',
    name: 'Phải thu nội bộ về chênh lệch tỷ giá - ngắn hạn',
    nameEn: 'Internal receivables on foreign exchange difference - short term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '13622',
    name: 'Phải thu nội bộ về chênh lệch tỷ giá - dài hạn',
    nameEn: 'Internal receivables on foreign exchange difference - long term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '13631',
    name: 'Phải thu nội bộ về chi phí đi vay đủ điều kiện được vốn hoá - ngắn hạn',
    nameEn: 'Internal receivables on borrowing costs eligible for capitalization - short term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '13632',
    name: 'Phải thu nội bộ về chi phí đi vay đủ điều kiện được vốn hoá - dài hạn',
    nameEn: 'Internal receivables on borrowing costs eligible for capitalization - long term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '13681',
    name: 'Phải thu nội bộ khác - ngắn hạn',
    nameEn: 'Other internal receivables - short term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '13682',
    name: 'Phải thu nội bộ khác - dài hạn',
    nameEn: 'Other internal receivables - long term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '13811',
    name: 'Tài sản thiếu chờ xử lý - ngắn hạn',
    nameEn: 'Shortage of assets awaiting resolution - short term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '13812',
    name: 'Tài sản thiếu chờ xử lý - dài hạn',
    nameEn: 'Shortage of assets awaiting resolution - long term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '13831',
    name: 'Thuế TTĐB của hàng nhập khẩu - ngắn hạn',
    nameEn: 'Special consumption tax of imported goods - short term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '13832',
    name: 'Thuế TTĐB của hàng nhập khẩu - dài hạn',
    nameEn: 'Special consumption tax of imported goods - long term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '13881',
    name: 'Phải thu khác - ngắn hạn',
    nameEn: 'Other receivables - short term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '13882',
    name: 'Phải thu khác - dài hạn',
    nameEn: 'Other receivables - long term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '1411',
    name: 'Tạm ứng - ngắn hạn',
    nameEn: 'Advances - short term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '1412',
    name: 'Tạm ứng - dài hạn',
    nameEn: 'Advances - long term',
    accountType: 'asset_receivable',
    reconcile: true,
  },
  {
    code: '151',
    name: 'Hàng mua đang đi đường',
    nameEn: 'Goods in transit',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '152',
    name: 'Nguyên liệu, vật liệu',
    nameEn: 'Raw materials',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '1531',
    name: 'Công cụ, dụng cụ - ngắn hạn',
    nameEn: 'Tools & supplies - Short term',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '1532',
    name: 'Công cụ, dụng cụ - Dài hạn',
    nameEn: 'Tools & supplies - Long term',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '1541',
    name: 'Chi phí sản xuất, kinh doanh dở dang - ngắn hạn',
    nameEn: 'Work in Progress - Short term',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '1542',
    name: 'Chi phí sản xuất, kinh doanh dở dang - Dài hạn',
    nameEn: 'Work in Progress - Long term',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '155',
    name: 'Sản phẩm',
    nameEn: 'Finished Goods',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '156',
    name: 'Hàng hoá',
    nameEn: 'Goods',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '157',
    name: 'Hàng gửi đi bán',
    nameEn: 'Outward goods on consignment',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '158',
    name: 'Hàng hóa kho bảo thuế',
    nameEn: 'Goods in bonded warehouse',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '171',
    name: 'Giao dịch mua bán lại trái phiếu chính phủ',
    nameEn: 'Government bonds purchase-resale',
    accountType: 'asset_current',
    reconcile: false,
  },
  {
    code: '211',
    name: 'Tài sản cố định hữu hình',
    nameEn: 'Tangible fixed assets',
    accountType: 'asset_fixed',
    reconcile: false,
  },
  {
    code: '212',
    name: 'Tài sản cố định thuê tài chính',
    nameEn: 'Financial leased tangible fixed assets',
    accountType: 'asset_fixed',
    reconcile: false,
  },
  {
    code: '213',
    name: 'Tài sản cố định vô hình',
    nameEn: 'Intangible fixed assets',
    accountType: 'asset_fixed',
    reconcile: false,
  },
  {
    code: '2141',
    name: 'Hao mòn TSCĐ hữu hình',
    nameEn: 'Depreciation of tangible fixed assets',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '2142',
    name: 'Hao mòn TSCĐ thuê tài chính',
    nameEn: 'Depreciation of financial leased assets',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '2143',
    name: 'Hao mòn TSCĐ vô hình',
    nameEn: 'Depreciation of intangible fixed assets',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '2147',
    name: 'Hao mòn bất động sản đầu tư',
    nameEn: 'Depreciation of investment properties',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '21511',
    name: 'Súc vật nuôi cho sản phẩm định kỳ chưa đạt đến giai đoạn trưởng thành',
    nameEn: 'Livestock for periodic production that have not yet reached maturity',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '215121',
    name: 'Nguyên giá',
    nameEn: 'Original price',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '215122',
    name: 'Giá trị khấu hao luỹ kế',
    nameEn: 'Accumulated Depreciation',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '21521',
    name: 'Súc vật nuôi lấy sản phẩm một lần - Ngắn hạn',
    nameEn: 'Livestock that produces one-time products - Short term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '21522',
    name: 'Súc vật nuôi lấy sản phẩm một lần - Dài hạn',
    nameEn: 'Livestock that produces one-time products - Long term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '21531',
    name: 'Cây trồng theo mùa vụ hoặc lấy sản phẩm một lần - Ngắn hạn',
    nameEn: 'Seasonal or one-time crop - Short term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '21532',
    name: 'Cây trồng theo mùa vụ hoặc lấy sản phẩm một lần - Dài hạn',
    nameEn: 'Seasonal or one-time crop - Long term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '217',
    name: 'Bất động sản đầu tư',
    nameEn: 'Investment properties',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '221',
    name: 'Đầu tư vào công ty con',
    nameEn: 'Investment in subsidiaries',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '222',
    name: 'Đầu tư vào công ty liên doanh, liên kết',
    nameEn: 'Investment in joint ventures and associates',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22811',
    name: 'Đầu tư góp vốn vào đơn vị khác - ngắn hạn',
    nameEn: 'Equity investments in other entities - short term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22812',
    name: 'Đầu tư góp vốn vào đơn vị khác - dài hạn',
    nameEn: 'Equity investments in other entities - long term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22881',
    name: 'Đầu tư khác - ngắn hạn',
    nameEn: 'Other investment - short term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22882',
    name: 'Đầu tư khác - dài hạn',
    nameEn: 'Other investment - long term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '2291',
    name: 'Dự phòng giảm giá chứng khoán kinh doanh',
    nameEn: 'Provision for decline in value of trading securities',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22921',
    name: 'Dự phòng tổn thất đầu tư vào đơn vị khác- ngắn hạn',
    nameEn: 'Provision for investment loss in other entities - short term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22922',
    name: 'Dự phòng tổn thất đầu tư vào hợp đồng BBC- ngắn hạn',
    nameEn: 'Provision for investment loss in BBC contracts - short term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22923',
    name: 'Dự phòng tổn thất đầu tư vào đơn vị khác- dài hạn',
    nameEn: 'Provision for investment loss in other entities - long term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22924',
    name: 'Dự phòng tổn thất đầu tư vào đơn vị khác nắm giữ đến ngày đáo hạn - dài hạn',
    nameEn: 'Provision for investment loss in other entities held to maturity - long term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22931',
    name: 'Dự phòng phải thu khó đòi - ngắn hạn',
    nameEn: 'Provision for doubtful debts - short term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22932',
    name: 'Dự phòng phải thu khó đòi - dài hạn',
    nameEn: 'Provision for doubtful debts - long term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22941',
    name: 'Dự phòng giảm giá hàng tồn kho',
    nameEn: 'Provision for reserve inventories',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22942',
    name: 'Dự phòng giảm giá hàng tồn kho- chi phí sản xuất, kinh doanh dở dang dài hạn',
    nameEn: 'Provision for reserve inventories - long term work in progress',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22943',
    name: 'Dự phòng giảm giá hàng tồn kho- thiết bị, vật tư, phụ tùng thay thế dài hạn',
    nameEn: 'Provision for reserve inventories (Equipment and Spare parts)',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22951',
    name: 'Dự phòng tổn thất tài sản sinh học - Ngắn hạn',
    nameEn: 'Provision for biology asset loss - Short term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '22952',
    name: 'Dự phòng tổn thất tài sản sinh học - Dài hạn',
    nameEn: 'Provision for biology asset loss - Long term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '2411',
    name: 'Mua sắm TSCĐ',
    nameEn: 'Acquisition of fixed assets',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '2412',
    name: 'Xây dựng cơ bản',
    nameEn: 'Construction in progress',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '2413',
    name: 'Sửa chữa, bảo dưỡng định kỳ TSCĐ',
    nameEn: 'Periodic repairs and maintenance of fixed assets',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '2414',
    name: 'Nâng cấp, cải tạo TSCĐ',
    nameEn: 'Upgrading, renovating fixed assets',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '2421',
    name: 'Chi phí chờ phân bổ - ngắn hạn',
    nameEn: 'Expenses waiting for allocation - short term',
    accountType: 'asset_prepayments',
    reconcile: false,
  },
  {
    code: '2422',
    name: 'Chi phí chờ phân bổ - dài hạn',
    nameEn: 'Expenses waiting for allocation - long term',
    accountType: 'asset_prepayments',
    reconcile: false,
  },
  {
    code: '243',
    name: 'Tài sản thuế thu nhập hoãn lại',
    nameEn: 'Deferred tax assets',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '2441',
    name: 'Ký quỹ, ký cược - ngắn hạn',
    nameEn: 'Deposits - short term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '2442',
    name: 'Ký quỹ, ký cược - dài hạn',
    nameEn: 'Deposits - long term',
    accountType: 'asset_non_current',
    reconcile: false,
  },
  {
    code: '3311',
    name: 'Phải trả cho người bán - ngắn hạn',
    nameEn: 'Trade payables - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '3312',
    name: 'Phải trả cho người bán - dài hạn',
    nameEn: 'Trade payables - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '332',
    name: 'Phải trả cổ tức, lợi nhuận',
    nameEn: 'Dividend payable',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33311',
    name: 'Thuế GTGT đầu ra',
    nameEn: 'Output VAT',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33312',
    name: 'Thuế GTGT hàng nhập khẩu',
    nameEn: 'VAT on imported goods',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33321',
    name: 'Thuế tiêu thụ đặc biệt - ngắn hạn',
    nameEn: 'Special consumption tax- short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33322',
    name: 'Thuế tiêu thụ đặc biệt - dài hạn',
    nameEn: 'Special consumption tax - long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33331',
    name: 'Thuế xuất, nhập khẩu - ngắn hạn',
    nameEn: 'Import & export tax - short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33332',
    name: 'Thuế xuất, nhập khẩu - dài hạn',
    nameEn: 'Import & export tax - long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33341',
    name: 'Thuế thu nhập doanh nghiệp - ngắn hạn',
    nameEn: 'Corporate income tax - short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33342',
    name: 'Thuế thu nhập doanh nghiệp - dài hạn',
    nameEn: 'Corporate income tax - long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33351',
    name: 'Thuế thu nhập cá nhân - ngắn hạn',
    nameEn: 'Personal income tax - short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33352',
    name: 'Thuế thu nhập cá nhân - dài hạn',
    nameEn: 'Personal income tax - long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33361',
    name: 'Thuế tài nguyên - ngắn hạn',
    nameEn: 'Natural resources using tax - short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33362',
    name: 'Thuế tài nguyên - dài hạn',
    nameEn: 'Natural resources using tax - long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33371',
    name: 'Thuế nhà đất, tiền thuê đất - ngắn hạn',
    nameEn: 'Land & housing tax, land rental charges - short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33372',
    name: 'Thuế nhà đất, tiền thuê đất - dài hạn',
    nameEn: 'Land & housing tax, land rental charges - long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33381',
    name: 'Thuế bảo vệ môi trường',
    nameEn: 'Environment protection tax',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33382',
    name: 'Các loại thuế khác',
    nameEn: 'Other taxes',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '33391',
    name: 'Phí, lệ phí và các khoản phải nộp khác - ngắn hạn',
    nameEn: 'Fees & charges & other payables - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33392',
    name: 'Phí, lệ phí và các khoản phải nộp khác - dài hạn',
    nameEn: 'Fees & charges & other payables - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '3341',
    name: 'Phải trả công nhân viên - ngắn hạn',
    nameEn: 'Payables to staff - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '3342',
    name: 'Phải trả công nhân viên - dài hạn',
    nameEn: 'Payables to staff - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '3351',
    name: 'Chi phí phải trả - ngắn hạn',
    nameEn: 'Accrued expenses - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '3352',
    name: 'Chi phí phải trả - dài hạn',
    nameEn: 'Accrued expenses - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '3361',
    name: 'Phải trả nội bộ về vốn kinh doanh',
    nameEn: 'Internal payables for working capital received',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33621',
    name: 'Phải trả nội bộ về chênh lệch tỉ giá - ngắn hạn',
    nameEn: 'Internal payables for foreign exchange differences - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33622',
    name: 'Phải trả nội bộ về chênh lệch tỉ giá - dài hạn',
    nameEn: 'Internal payables for foreign exchange differences - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33631',
    name: 'Phải trả nội bộ về chi phí đi vay đủ điều kiện được vốn hoá - ngắn hạn',
    nameEn: 'Internal payables for borrowing costs eligible for capitalization - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33632',
    name: 'Phải trả nội bộ về chi phí đi vay đủ điều kiện được vốn hoá - dài hạn',
    nameEn: 'Internal payables for borrowing costs eligible for capitalization - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33681',
    name: 'Phải trả nội bộ khác - ngắn hạn',
    nameEn: 'Other internal payables - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33682',
    name: 'Phải trả nội bộ khác -  dài hạn',
    nameEn: 'Other internal payables - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '337',
    name: 'Thanh toán theo tiến độ hợp đồng xây dựng',
    nameEn: 'Progress billings for construction contracts',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33811',
    name: 'Tài sản thừa chờ giải quyết - ngắn hạn',
    nameEn: 'Surplus of assets awaiting for resolution - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33812',
    name: 'Tài sản thừa chờ giải quyết - dài hạn',
    nameEn: 'Surplus of assets awaiting for resolution - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33821',
    name: 'Kinh phí công đoàn - ngắn hạn',
    nameEn: 'Trade union fees - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33822',
    name: 'Kinh phí công đoàn - dài hạn',
    nameEn: 'Trade union fees - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33831',
    name: 'Bảo hiểm xã hội - ngắn hạn',
    nameEn: 'Social insurance - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33832',
    name: 'Bảo hiểm xã hội - dài hạn',
    nameEn: 'Social insurance - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33841',
    name: 'Bảo hiểm y tế - ngắn hạn',
    nameEn: 'Health insurance - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33842',
    name: 'Bảo hiểm y tế - dài hạn',
    nameEn: 'Health insurance - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33861',
    name: 'Bảo hiểm thất nghiệp - ngắn hạn',
    nameEn: 'Unemployment insurance - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33862',
    name: 'Bảo hiểm thất nghiệp - dài hạn',
    nameEn: 'Unemployment insurance - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33871',
    name: 'Doanh thu chưa thực hiện - ngắn hạn',
    nameEn: 'Unearned revenue - short term',
    accountType: 'liability_current',
    reconcile: true,
  },
  {
    code: '33872',
    name: 'Doanh thu chưa thực hiện - dài hạn',
    nameEn: 'Unearned revenue - long term',
    accountType: 'liability_current',
    reconcile: true,
  },
  {
    code: '33881',
    name: 'Phải trả, phải nộp khác - ngắn hạn',
    nameEn: 'Other payables - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '33882',
    name: 'Phải trả, phải nộp khác - dài hạn',
    nameEn: 'Other payables - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '34111',
    name: 'Các khoản đi vay - ngắn hạn',
    nameEn: 'Borrowings - short term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '34112',
    name: 'Các khoản đi vay - dài hạn',
    nameEn: 'Borrowings - long term',
    accountType: 'liability_payable',
    reconcile: true,
  },
  {
    code: '34121',
    name: 'Nợ thuê tài chính - ngắn hạn',
    nameEn: 'Financial leased liabilities - short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '34122',
    name: 'Nợ thuê tài chính - dài hạn',
    nameEn: 'Financial leased liabilities - long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '34311',
    name: 'Trái phiếu thường - ngắn hạn',
    nameEn: 'Ordinary bonds - Short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '34312',
    name: 'Trái phiếu thường - dài hạn',
    nameEn: 'Ordinary bonds - Long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '3432',
    name: 'Trái phiếu chuyển đổi',
    nameEn: 'Convertible bonds',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '3441',
    name: 'Nhận ký quỹ, ký cược - ngắn hạn',
    nameEn: 'Deposits received - short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '3442',
    name: 'Nhận ký quỹ, ký cược - dài hạn',
    nameEn: 'Deposits received - long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '347',
    name: 'Thuế thu nhập hoãn lại phải trả',
    nameEn: 'Deferred tax liabilities',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '35211',
    name: 'Dự phòng bảo hành sản phẩm hàng hoá - ngắn hạn',
    nameEn: 'Product warranty provisions - short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '35212',
    name: 'Dự phòng bảo hành sản phẩm hàng hoá - dài hạn',
    nameEn: 'Product warranty provisions - long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '35221',
    name: 'Dự phòng bảo hành công trình xây dựng - ngắn hạn',
    nameEn: 'Construction warranty provisions - short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '35222',
    name: 'Dự phòng bảo hành công trình xây dựng - dài hạn',
    nameEn: 'Construction warranty provisions - long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '35231',
    name: 'Dự phòng tái cơ cấu doanh nghiệp - ngắn hạn',
    nameEn: 'Enterprise restructuring provisions - short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '35232',
    name: 'Dự phòng tái cơ cấu doanh nghiệp - dài hạn',
    nameEn: 'Enterprise restructuring provisions - long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '35251',
    name: 'Dự phòng phải trả khác - ngắn hạn',
    nameEn: 'Other provisions - short term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '35252',
    name: 'Dự phòng phải trả khác - dài hạn',
    nameEn: 'Other provisions - long term',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '3531',
    name: 'Quỹ khen thưởng',
    nameEn: 'Bonus fund',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '3532',
    name: 'Quỹ phúc lợi',
    nameEn: 'Welfare fund',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '3533',
    name: 'Quỹ phúc lợi đã hình thành TSCĐ',
    nameEn: 'Welfare fund used for fixed asset acquisitions',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '3534',
    name: 'Quỹ thưởng ban quản lý điều hành công ty',
    nameEn: 'Management bonus fund',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '3561',
    name: 'Quỹ phát triển khoa học và công nghệ',
    nameEn: 'Science and technology development fund',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '3562',
    name: 'Quỹ phát triển khoa học và công nghệ đã hình thành TSCĐ',
    nameEn: 'Science and technology development fund used for fixed asset acquisition',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '357',
    name: 'Quỹ bình ổn giá',
    nameEn: 'Price stabilization fund',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '41111',
    name: 'Cổ phiếu phổ thông có quyền biểu quyết',
    nameEn: 'Ordinary shares with voting rights',
    accountType: 'equity',
    reconcile: false,
  },
  {
    code: '411121',
    name: 'Cổ phiếu ưu đãi - Nợ phải trả',
    nameEn: 'Preferred shares - payable',
    accountType: 'liability_current',
    reconcile: false,
  },
  {
    code: '411122',
    name: 'Cổ phiếu ưu đãi - Vốn chủ sở hữu',
    nameEn: "Preferred shares - owner's equity",
    accountType: 'equity',
    reconcile: false,
  },
  {
    code: '4112',
    name: 'Thặng dư vốn',
    nameEn: 'Capital surplus',
    accountType: 'equity',
    reconcile: false,
  },
  {
    code: '4113',
    name: 'Quyền chọn chuyển đổi trái phiếu',
    nameEn: 'Conversion options on convertible bonds',
    accountType: 'equity',
    reconcile: false,
  },
  {
    code: '4118',
    name: 'Vốn khác',
    nameEn: 'Other capital',
    accountType: 'equity',
    reconcile: false,
  },
  {
    code: '412',
    name: 'Chênh lệch đánh giá lại tài sản',
    nameEn: 'Revaluation differences on asset',
    accountType: 'equity',
    reconcile: false,
  },
  {
    code: '413',
    name: 'Chênh lệch tỷ giá hối đoái',
    nameEn: 'Exchange rate differences',
    accountType: 'equity',
    reconcile: false,
  },
  {
    code: '414',
    name: 'Quỹ đầu tư phát triển',
    nameEn: 'Investment & development fund',
    accountType: 'equity',
    reconcile: false,
  },
  {
    code: '418',
    name: 'Các quỹ khác thuộc vốn chủ sở hữu',
    nameEn: 'Other equity funds',
    accountType: 'equity',
    reconcile: false,
  },
  {
    code: '419',
    name: 'Cổ phiếu mua lại của chính mình',
    nameEn: 'Stocks bought from oneself',
    accountType: 'equity',
    reconcile: false,
  },
  {
    code: '4211',
    name: 'Lợi nhuận sau thuế chưa phân phối năm trước',
    nameEn: 'Undistributed profit after tax of previous year',
    accountType: 'equity',
    reconcile: false,
  },
  {
    code: '4212',
    name: 'Lợi nhuận sau thuế chưa phân phối năm nay',
    nameEn: 'Undistributed profit after tax of current year',
    accountType: 'equity',
    reconcile: false,
  },
  {
    code: '511',
    name: 'Doanh thu bán hàng và cung cấp dịch vụ',
    nameEn: 'Revenue from sales and services',
    accountType: 'income',
    reconcile: false,
  },
  {
    code: '515',
    name: 'Doanh thu hoạt động tài chính',
    nameEn: 'Financial income',
    accountType: 'income',
    reconcile: false,
  },
  {
    code: '521',
    name: 'Các khoản giảm trừ doanh thu',
    nameEn: 'Sales discounts',
    accountType: 'income',
    reconcile: false,
  },
  {
    code: '621',
    name: 'Chi phí nguyên liệu, vật liệu trực tiếp',
    nameEn: 'Direct raw material costs',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '622',
    name: 'Chi phí nhân công trực tiếp',
    nameEn: 'Direct labour costs',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '6231',
    name: 'Chi phí nhân công',
    nameEn: 'Labour costs',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '6232',
    name: 'Chi phí nguyên, vật liệu',
    nameEn: 'Material costs',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '6233',
    name: 'Chi phí dụng cụ sản xuất',
    nameEn: 'Tools and instruments',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '6234',
    name: 'Chi phí khấu hao máy thi công',
    nameEn: 'Equipment depreciation expense',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '6237',
    name: 'Chi phí dịch vụ mua ngoài',
    nameEn: 'Outside services',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '6238',
    name: 'Chi phí bằng tiền khác',
    nameEn: 'Other expenses',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '6271',
    name: 'Chi phí nhân viên phân xưởng',
    nameEn: 'Factory staff costs',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '6272',
    name: 'Chi phí nguyên, vật liệu',
    nameEn: 'Material costs',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '6273',
    name: 'Chi phí dụng cụ sản xuất',
    nameEn: 'Tools and instruments',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '6274',
    name: 'Chi phí khấu hao TSCĐ',
    nameEn: 'Fixed asset depreciation',
    accountType: 'expense_depreciation',
    reconcile: false,
  },
  {
    code: '6275',
    name: 'Thuế, phí, lệ phí',
    nameEn: 'Taxes, fees and charges',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '6277',
    name: 'Chi phí dịch vụ mua ngoài',
    nameEn: 'Outside services',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '6278',
    name: 'Chi phí bằng tiền khác',
    nameEn: 'Other expenses',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '632',
    name: 'Giá vốn hàng bán',
    nameEn: 'Costs of goods sold',
    accountType: 'expense_direct_cost',
    reconcile: false,
  },
  {
    code: '635',
    name: 'Chi phí tài chính',
    nameEn: 'Financial expenses',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6351',
    name: 'Chi phí tài chính',
    nameEn: 'Financial expenses - interest expense',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6411',
    name: 'Chi phí nhân viên',
    nameEn: 'Employees costs',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6412',
    name: 'Chi phí nguyên vật liệu, bao bì',
    nameEn: 'Materials and packing materials',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6413',
    name: 'Chi phí dụng cụ, đồ dùng',
    nameEn: 'Tools and instruments',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6414',
    name: 'Chi phí khấu hao TSCĐ',
    nameEn: 'Fixed asset depreciation',
    accountType: 'expense_depreciation',
    reconcile: false,
  },
  {
    code: '6415',
    name: 'Thuế, phí, lệ phí',
    nameEn: 'Taxes, fees and charges',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6417',
    name: 'Chi phí dịch vụ mua ngoài',
    nameEn: 'Outside services',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6418',
    name: 'Chi phí bằng tiền khác',
    nameEn: 'Other expenses',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6421',
    name: 'Chi phí nhân viên',
    nameEn: 'Employees management costs',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6422',
    name: 'Chi phí vật liệu quản lý',
    nameEn: 'Office supply expenses',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6423',
    name: 'Chi phí đồ dùng văn phòng',
    nameEn: 'Stationery costs',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6424',
    name: 'Chi phí khấu hao TSCĐ',
    nameEn: 'Fixed asset depreciation',
    accountType: 'expense_depreciation',
    reconcile: false,
  },
  {
    code: '6425',
    name: 'Thuế, phí và lệ phí',
    nameEn: 'Taxes, fees and charges',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6426',
    name: 'Chi phí dự phòng',
    nameEn: 'Provision expenses',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6427',
    name: 'Chi phí dịch vụ mua ngoài',
    nameEn: 'Outside services',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '6428',
    name: 'Chi phí bằng tiền khác',
    nameEn: 'Other expenses',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '711',
    name: 'Thu nhập khác',
    nameEn: 'Other Income',
    accountType: 'income_other',
    reconcile: false,
  },
  {
    code: '811',
    name: 'Chi phí khác',
    nameEn: 'Other Expenses',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '82111',
    name: 'Chi phí thuế thu nhập doanh nghiệp hiện hành theo quy định của Luật thuế thu nhập doanh nghiệp',
    nameEn:
      'Current corporate income tax expenses according to the provisions of the Law on Corporate Income Tax',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '82112',
    name: 'Chi phí thuế thu nhập doanh nghiệp bổ sung theo quy định về thuế tối thiểu toàn cầu',
    nameEn: 'Additional corporate income tax expense under the global minimum tax rules',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '8212',
    name: 'Chi phí thuế thu nhập doanh nghiệp hoãn lại',
    nameEn: 'Deferred tax expense',
    accountType: 'expense',
    reconcile: false,
  },
  {
    code: '911',
    name: 'Xác định kết quả kinh doanh',
    nameEn: 'Income Summary',
    accountType: 'equity_unaffected',
    reconcile: false,
  },
] as const

/**
 * What a document posts to when nothing more specific applies.
 *
 * Circular 99 answers this the same way for every Vietnamese company, so the
 * install answers it once instead of asking on every invoice: revenue to 511,
 * cost of goods sold to 632, trade receivables to 1311, trade payables to 3311.
 * A company that files differently changes them on the accounting defaults
 * screen, and a product category can override the two profit-and-loss ones.
 */
export const TT99_DEFAULT_ACCOUNTS = {
  income: '511',
  expense: '632',
  receivable: '1311',
  payable: '3311',
} as const

export const TT99_CODE = 'TT99_2025'
export const TT99_COUNTRY = 'VN'
export const TT99_LEGAL_BASIS = 'Thông tư 99/2025/TT-BTC ngày 27/10/2025'
export const TT99_CATALOG_SCHEMA_VERSION = 1
export const TT99_CATALOG_VERSION = '1.0.0'
export const TT99_ISSUED_ON = '2025-10-27'
export const TT99_EFFECTIVE_FROM = '2026-01-01'
export const TT99_EFFECTIVE_TO: string | null = null
export const TT99_AUTHORITY = 'Bộ Tài chính'
export const TT99_SOURCE_URL =
  'https://www.mof.gov.vn/tin-tuc-tai-chinh/tin-chinh-sach-tai-chinh/quy-dinh-moi-ve-che-do-ke-toan-doanh-nghiep'
export const TT99_APPROVAL_STATUS = 'provisional' as const
export const TT99_EXPECTED_ACCOUNT_COUNT = 216
export const TT99_EXPECTED_TAX_COUNT = 17

export type Tt99CatalogApprovalStatus = 'provisional' | 'approved' | 'retired'

export type Tt99CatalogMetadata = {
  version: string
  standard: string
  countryCode: string
  authority: string
  sourceUrl: string
  legalBasis: string
  issuedOn: string
  effectiveFrom: string
  effectiveTo: string | null
  approvalStatus: Tt99CatalogApprovalStatus
}

/** Statutory identity is part of the checksum, not prose living beside the data. */
export const TT99_CATALOG_METADATA: Readonly<Tt99CatalogMetadata> = {
  version: TT99_CATALOG_VERSION,
  standard: TT99_CODE,
  countryCode: TT99_COUNTRY,
  authority: TT99_AUTHORITY,
  sourceUrl: TT99_SOURCE_URL,
  legalBasis: TT99_LEGAL_BASIS,
  issuedOn: TT99_ISSUED_ON,
  effectiveFrom: TT99_EFFECTIVE_FROM,
  effectiveTo: TT99_EFFECTIVE_TO,
  approvalStatus: TT99_APPROVAL_STATUS,
}

export type VietnamTax = {
  key: string
  name: string
  description: string
  use: 'sale' | 'purchase'
  amount: string
  accountCode?: string
  includeBaseAmount?: boolean
}

export const VIETNAM_TAXES: readonly VietnamTax[] = [
  {
    key: 'vat-purchase-10',
    name: 'GTGT 10%',
    description: 'Thuế GTGT được khấu trừ 10%',
    use: 'purchase',
    amount: '10',
    accountCode: '1331',
  },
  {
    key: 'vat-purchase-8',
    name: 'GTGT 8%',
    description: 'Thuế GTGT được khấu trừ 8%',
    use: 'purchase',
    amount: '8',
    accountCode: '1331',
  },
  {
    key: 'vat-purchase-5',
    name: 'GTGT 5%',
    description: 'Thuế GTGT được khấu trừ 5%',
    use: 'purchase',
    amount: '5',
    accountCode: '1331',
  },
  {
    key: 'vat-purchase-0',
    name: 'GTGT 0%',
    description: 'Thuế GTGT được khấu trừ 0%',
    use: 'purchase',
    amount: '0',
    accountCode: '1331',
  },
  {
    key: 'vat-purchase-exempt',
    name: 'KCT',
    description: 'Không thuộc đối tượng chịu thuế GTGT',
    use: 'purchase',
    amount: '0',
  },
  {
    key: 'vat-purchase-not-declared',
    name: 'KKKNT',
    description: 'Không kê khai, tính nộp thuế GTGT',
    use: 'purchase',
    amount: '0',
  },
  {
    key: 'vat-sale-10',
    name: 'GTGT 10%',
    description: 'Thuế GTGT phải nộp 10%',
    use: 'sale',
    amount: '10',
    accountCode: '33311',
  },
  {
    key: 'vat-sale-8',
    name: 'GTGT 8%',
    description: 'Thuế GTGT phải nộp 8%',
    use: 'sale',
    amount: '8',
    accountCode: '33311',
  },
  {
    key: 'vat-sale-5',
    name: 'GTGT 5%',
    description: 'Thuế GTGT phải nộp 5%',
    use: 'sale',
    amount: '5',
    accountCode: '33311',
  },
  {
    key: 'vat-sale-0',
    name: 'GTGT 0%',
    description: 'Thuế GTGT phải nộp 0%',
    use: 'sale',
    amount: '0',
    accountCode: '33311',
  },
  {
    key: 'vat-sale-exempt',
    name: 'KCT',
    description: 'Không thuộc đối tượng chịu thuế GTGT',
    use: 'sale',
    amount: '0',
  },
  {
    key: 'vat-sale-not-declared',
    name: 'KKKNT',
    description: 'Không kê khai, tính nộp thuế GTGT',
    use: 'sale',
    amount: '0',
  },
  {
    key: 'vat-purchase-import-10',
    name: 'GTGT hàng nhập khẩu 10%',
    description: 'Thuế GTGT được khấu trừ cho hàng nhập khẩu 10%',
    use: 'purchase',
    amount: '10',
    accountCode: '1331',
  },
  {
    key: 'vat-purchase-import-8',
    name: 'GTGT hàng nhập khẩu 8%',
    description: 'Thuế GTGT được khấu trừ cho hàng nhập khẩu 8%',
    use: 'purchase',
    amount: '8',
    accountCode: '1331',
  },
  {
    key: 'vat-purchase-import-5',
    name: 'GTGT hàng nhập khẩu 5%',
    description: 'Thuế GTGT được khấu trừ cho hàng nhập khẩu 5%',
    use: 'purchase',
    amount: '5',
    accountCode: '1331',
  },
  {
    key: 'vat-purchase-import-0',
    name: 'GTGT hàng nhập khẩu 0%',
    description: 'Thuế GTGT được khấu trừ cho hàng nhập khẩu 0%',
    use: 'purchase',
    amount: '0',
    accountCode: '1331',
  },
  {
    key: 'import-5',
    name: 'Thuế nhập khẩu 5%',
    description: 'Thuế nhập khẩu',
    use: 'purchase',
    amount: '5',
    accountCode: '33331',
    includeBaseAmount: true,
  },
] as const

export type Tt99CanonicalTax = {
  key: string
  name: string
  description: string
  use: 'sale' | 'purchase'
  amount: string
  accountCode: string | null
  includeBaseAmount: boolean
}

export type Tt99CatalogManifest = {
  schemaVersion: number
  metadata: Tt99CatalogMetadata
  counts: { accounts: number; taxes: number }
  defaults: { income: string; expense: string; receivable: string; payable: string }
  accounts: Tt99Account[]
  taxes: Tt99CanonicalTax[]
}

export type Tt99CatalogSource = {
  metadata?: Tt99CatalogMetadata
  defaults?: Tt99CatalogManifest['defaults']
  accounts?: readonly Tt99Account[]
  taxes?: readonly VietnamTax[]
}

const lexical = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const jsonPrimitive = (value: string | number | boolean): string => {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError('TT99 canonical JSON could not encode a primitive')
  return encoded
}

/**
 * JSON with one spelling: object keys are lexical, arrays keep their supplied
 * order, and unsupported values fail instead of being silently omitted.
 */
export const canonicalTT99Json = (value: unknown): string => {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return jsonPrimitive(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('TT99 canonical JSON requires finite numbers')
    return jsonPrimitive(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalTT99Json).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      lexical(left, right),
    )
    if (entries.some(([, held]) => held === undefined))
      throw new TypeError('TT99 canonical JSON does not permit undefined values')
    return `{${entries.map(([key, held]) => `${jsonPrimitive(key)}:${canonicalTT99Json(held)}`).join(',')}}`
  }
  throw new TypeError(`TT99 canonical JSON does not support ${typeof value}`)
}

/** Normalize source order and optional tax fields before serialization. */
export const buildTT99CatalogManifest = (source: Tt99CatalogSource = {}): Tt99CatalogManifest => {
  const accounts = [...(source.accounts ?? TT99_ACCOUNTS)]
    .map((account) => ({
      code: String(account.code),
      name: String(account.name),
      nameEn: String(account.nameEn),
      accountType: String(account.accountType),
      reconcile: account.reconcile === true,
    }))
    .sort((left, right) => lexical(left.code, right.code))
  const taxes = [...(source.taxes ?? VIETNAM_TAXES)]
    .map((tax) => ({
      key: String(tax.key),
      name: String(tax.name),
      description: String(tax.description),
      use: tax.use,
      amount: String(tax.amount),
      accountCode: tax.accountCode == null ? null : String(tax.accountCode),
      includeBaseAmount: tax.includeBaseAmount === true,
    }))
    .sort((left, right) => lexical(left.key, right.key))
  return {
    schemaVersion: TT99_CATALOG_SCHEMA_VERSION,
    metadata: { ...(source.metadata ?? TT99_CATALOG_METADATA) },
    counts: { accounts: accounts.length, taxes: taxes.length },
    defaults: { ...(source.defaults ?? TT99_DEFAULT_ACCOUNTS) },
    accounts,
    taxes,
  }
}

const catalogError = (message: string): never => {
  throw new Error(`invalid TT99 catalog: ${message}`)
}

/** Fail closed when the bundled statutory data no longer satisfies its contract. */
export const assertTT99Catalog = (manifest: Tt99CatalogManifest): void => {
  const { metadata } = manifest
  const date = /^\d{4}-\d{2}-\d{2}$/
  if (manifest.schemaVersion !== TT99_CATALOG_SCHEMA_VERSION)
    catalogError(`schema version must be ${TT99_CATALOG_SCHEMA_VERSION}`)
  if (metadata.version !== TT99_CATALOG_VERSION)
    catalogError(`catalog version must be ${TT99_CATALOG_VERSION}`)
  if (metadata.standard !== TT99_CODE) catalogError(`standard must be ${TT99_CODE}`)
  if (metadata.countryCode !== TT99_COUNTRY) catalogError(`country must be ${TT99_COUNTRY}`)
  if (metadata.authority !== TT99_AUTHORITY) catalogError(`authority must be ${TT99_AUTHORITY}`)
  if (metadata.sourceUrl !== TT99_SOURCE_URL) catalogError(`source URL must be ${TT99_SOURCE_URL}`)
  if (metadata.legalBasis !== TT99_LEGAL_BASIS) catalogError(`legal basis must be ${TT99_LEGAL_BASIS}`)
  if (!date.test(metadata.issuedOn) || !date.test(metadata.effectiveFrom))
    catalogError('issuedOn and effectiveFrom must be civil ISO dates')
  if (metadata.issuedOn !== TT99_ISSUED_ON) catalogError(`issuedOn must be ${TT99_ISSUED_ON}`)
  if (metadata.effectiveFrom !== TT99_EFFECTIVE_FROM)
    catalogError(`effectiveFrom must be ${TT99_EFFECTIVE_FROM}`)
  if (metadata.effectiveTo !== TT99_EFFECTIVE_TO)
    catalogError(`effectiveTo must be ${String(TT99_EFFECTIVE_TO)}`)
  if (metadata.approvalStatus !== TT99_APPROVAL_STATUS)
    catalogError(`approval status must be ${TT99_APPROVAL_STATUS}`)
  if (metadata.issuedOn > metadata.effectiveFrom) catalogError('effectiveFrom cannot precede issuedOn')
  if (metadata.effectiveTo != null) {
    if (!date.test(metadata.effectiveTo)) catalogError('effectiveTo must be a civil ISO date')
    if (metadata.effectiveTo < metadata.effectiveFrom)
      catalogError('effectiveTo cannot precede effectiveFrom')
  }

  if (manifest.counts.accounts !== manifest.accounts.length)
    catalogError('account count metadata does not match the manifest')
  if (manifest.counts.taxes !== manifest.taxes.length)
    catalogError('tax count metadata does not match the manifest')
  if (manifest.accounts.length !== TT99_EXPECTED_ACCOUNT_COUNT)
    catalogError(`expected ${TT99_EXPECTED_ACCOUNT_COUNT} accounts, got ${manifest.accounts.length}`)
  if (manifest.taxes.length !== TT99_EXPECTED_TAX_COUNT)
    catalogError(`expected ${TT99_EXPECTED_TAX_COUNT} taxes, got ${manifest.taxes.length}`)

  const accounts = new Map<string, Tt99Account>()
  for (const account of manifest.accounts) {
    if (!/^\d+$/.test(account.code)) catalogError(`account code ${account.code} is not numeric`)
    if (accounts.has(account.code)) catalogError(`duplicate account code ${account.code}`)
    if (!account.name.trim()) catalogError(`account ${account.code} has no Vietnamese name`)
    if (!account.nameEn.trim()) catalogError(`account ${account.code} has no English name`)
    if (!account.accountType.trim()) catalogError(`account ${account.code} has no account type`)
    if (typeof account.reconcile !== 'boolean')
      catalogError(`account ${account.code} has an invalid reconcile flag`)
    accounts.set(account.code, account)
  }

  const expectedDefaults = {
    income: 'income',
    expense: 'expense_direct_cost',
    receivable: 'asset_receivable',
    payable: 'liability_payable',
  } as const
  for (const [kind, accountType] of Object.entries(expectedDefaults)) {
    const code = manifest.defaults[kind as keyof typeof manifest.defaults]
    const account = accounts.get(code)
    if (!account) catalogError(`default ${kind} account ${code} does not exist`)
    const held = account!
    if (held.accountType !== accountType)
      catalogError(`default ${kind} account ${code} must be ${accountType}`)
    if (['receivable', 'payable'].includes(kind) && held.reconcile !== true)
      catalogError(`default ${kind} account ${code} must be reconcilable`)
  }

  const keys = new Set<string>()
  const scopedNames = new Set<string>()
  for (const tax of manifest.taxes) {
    if (!tax.key.trim()) catalogError('tax key is required')
    if (tax.use !== 'sale' && tax.use !== 'purchase') catalogError(`tax ${tax.key} has an invalid use`)
    if (keys.has(tax.key)) catalogError(`duplicate tax key ${tax.key}`)
    keys.add(tax.key)
    const scopedName = `${tax.use}:${tax.name}`
    if (scopedNames.has(scopedName)) catalogError(`duplicate tax name ${scopedName}`)
    scopedNames.add(scopedName)
    if (!tax.name.trim() || !tax.description.trim()) catalogError(`tax ${tax.key} has incomplete labels`)
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(tax.amount)) catalogError(`tax ${tax.key} has an invalid amount`)
    if (tax.accountCode != null && !accounts.has(tax.accountCode))
      catalogError(`tax ${tax.key} points to missing account ${tax.accountCode}`)

    const classification = tax.key.endsWith('-exempt') || tax.key.endsWith('-not-declared')
    if (classification) {
      if (tax.accountCode !== null) catalogError(`classification ${tax.key} must not post to an account`)
      if (tax.includeBaseAmount) catalogError(`classification ${tax.key} cannot change the tax base`)
      continue
    }
    if (tax.key.startsWith('vat-purchase-')) {
      if (tax.accountCode !== '1331') catalogError(`purchase VAT ${tax.key} must post to 1331`)
    } else if (tax.key.startsWith('vat-sale-')) {
      if (tax.accountCode !== '33311') catalogError(`sale VAT ${tax.key} must post to 33311`)
    } else if (tax.key === 'import-5') {
      if (tax.accountCode !== '33331') catalogError('import duty must post to 33331')
      if (!tax.includeBaseAmount) catalogError('import duty must join the later VAT base')
    } else catalogError(`tax ${tax.key} has no statutory posting rule`)
    if (Number(tax.amount) > 0 && tax.accountCode === null)
      catalogError(`non-zero tax ${tax.key} needs a posting account`)
    if (tax.key !== 'import-5' && tax.includeBaseAmount)
      catalogError(`tax ${tax.key} must not change the later tax base`)
  }
}

export const serializeTT99Catalog = (source: Tt99CatalogSource = {}): string =>
  canonicalTT99Json(buildTT99CatalogManifest(source))

export const checksumTT99Catalog = (source: Tt99CatalogSource = {}): string =>
  createHash('sha256').update(serializeTT99Catalog(source)).digest('hex')

export const TT99_CATALOG_MANIFEST = buildTT99CatalogManifest()
assertTT99Catalog(TT99_CATALOG_MANIFEST)

/** Historical account-only marker stored by installations predating the tax catalog. */
export const TT99_ACCOUNT_CHECKSUM = '62e0ccee163b4b4b336a7c9c6e28823a97f9ef16462e2b378e8133ca856c6b71'

/**
 * Published full-catalog identity. Updating statutory content requires explicitly
 * approving this value; otherwise module initialization fails instead of silently
 * rolling every company's setup checksum forward.
 */
export const TT99_CATALOG_CHECKSUM = 'c2ee5de7daf9b4f9e98f587875d1c374a4c249cd0cfce1262f13457f472cb805'

const bundledCatalogChecksum = checksumTT99Catalog()
if (bundledCatalogChecksum !== TT99_CATALOG_CHECKSUM)
  catalogError(
    `published checksum ${TT99_CATALOG_CHECKSUM} does not match bundled catalog ${bundledCatalogChecksum}`,
  )
