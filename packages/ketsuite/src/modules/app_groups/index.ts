import { defineModuleGroups } from '@ketvietlab/ketjs'

export default defineModuleGroups({
  name: 'app_groups',
  groups: {
    system: {
      title: 'Hệ thống',
      summary: 'Nền tảng vận hành dùng chung: quản trị, danh tính, thư, hoạt động và lưu trữ.',
      sequence: 10,
      fixed: true,
    },
    crm: {
      title: 'CRM',
      summary: 'Quan hệ khách hàng và quản lý cơ hội.',
      sequence: 20,
    },
    commerce: {
      title: 'Thương mại',
      summary: 'Sản phẩm, mua hàng, bán hàng, kho vận và điểm bán.',
      sequence: 30,
    },
    accounting: {
      title: 'Kế toán',
      summary: 'Sổ sách kế toán và các cầu nối nghiệp vụ tài chính.',
      sequence: 40,
    },
    hospitality: {
      title: 'Khách sạn',
      summary: 'Lưu trú, đặt phòng, vận hành khách sạn và tích hợp liên quan.',
      sequence: 50,
    },
  },
  messages: {
    vi: {
      'group.system.title': 'Hệ thống',
      'group.system.summary': 'Nền tảng vận hành dùng chung: quản trị, danh tính, thư, hoạt động và lưu trữ.',
      'group.crm.title': 'CRM',
      'group.crm.summary': 'Quan hệ khách hàng và quản lý cơ hội.',
      'group.commerce.title': 'Thương mại',
      'group.commerce.summary': 'Sản phẩm, mua hàng, bán hàng, kho vận và điểm bán.',
      'group.accounting.title': 'Kế toán',
      'group.accounting.summary': 'Sổ sách kế toán và các cầu nối nghiệp vụ tài chính.',
      'group.hospitality.title': 'Khách sạn',
      'group.hospitality.summary': 'Lưu trú, đặt phòng, vận hành khách sạn và tích hợp liên quan.',
    },
    en: {
      'group.system.title': 'System',
      'group.system.summary': 'Shared operations: administration, identity, mail, activity, and storage.',
      'group.crm.title': 'CRM',
      'group.crm.summary': 'Customer relationships and opportunity management.',
      'group.commerce.title': 'Commerce',
      'group.commerce.summary': 'Products, purchasing, sales, inventory, and point of sale.',
      'group.accounting.title': 'Accounting',
      'group.accounting.summary': 'Accounting ledgers and their business integration bridges.',
      'group.hospitality.title': 'Hospitality',
      'group.hospitality.summary': 'Stays, reservations, hotel operations, and related integrations.',
    },
  },
})
