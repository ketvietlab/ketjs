import { createTestApp } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'

export async function collaborationEvidenceApp(
  options: { databaseUrl?: string; app?: typeof ketsuite } = {},
) {
  const e2e = await createTestApp(options.app ?? ketsuite, {
    worker: false,
    ...(options.databaseUrl ? { env: { DATABASE_URL: options.databaseUrl } } : {}),
  })
  const scope = { company: 'acme', branches: null }
  const call = <T = unknown>(
    name: string,
    input: Record<string, unknown> = {},
    actor: string | null = null,
  ) => e2e.fixture.call<T>(name, input, { scope, actor })
  try {
    for (const [id, kind, name] of [
      ['acme-party', 'company', 'ACME Distribution'],
      ['admin-party', 'person', 'Nguyễn Quản Trị'],
      ['member-party', 'person', 'Trần Điều Phối'],
    ])
      await call('partner.savePartner', {
        id,
        kind,
        name,
        email: `${id}@example.test`,
      })
    await call('company.saveCompany', {
      id: 'acme',
      partnerId: 'acme-party',
      currency: 'VND',
    })
    for (const [id, partnerId, name] of [
      ['admin', 'admin-party', 'Nguyễn Quản Trị'],
      ['member', 'member-party', 'Trần Điều Phối'],
    ]) {
      await call('user.createUser', {
        id,
        partnerId,
        login: id,
        password: 'correct horse',
        name,
        defaultCompanyId: 'acme',
        superuser: true,
      })
      await call('user.grantCompany', {
        id: `${id}:acme`,
        userId: id,
        companyId: 'acme',
      })
    }

    await call('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
    await call('product.saveTemplate', {
      id: 'tpl-collab',
      name: 'Áo khoác vận hành',
      type: 'goods',
      uomId: 'unit',
      listPrice: '1250000',
      description: 'Sản phẩm mẫu dùng để kiểm chứng Chatter trên Product.',
    })
    await call('product.saveVariant', {
      id: 'variant-collab',
      templateId: 'tpl-collab',
      defaultCode: 'OPS-JACKET',
      combinationKey: '',
    })
    await call('stock.configureProduct', {
      templateId: 'tpl-collab',
      isStorable: true,
      tracking: 'none',
    })
    for (const attribute of [
      { id: 'attribute-color', name: 'Màu sắc', displayType: 'pills', createVariant: 'always' },
      { id: 'attribute-size', name: 'Kích cỡ', displayType: 'radio', createVariant: 'always' },
      {
        id: 'attribute-material',
        name: 'Chất liệu',
        displayType: 'select',
        createVariant: 'no_variant',
      },
    ])
      await call('product.saveAttribute', { ...attribute, sequence: 10, active: true })
    for (const value of [
      { id: 'attribute-color-navy', attributeId: 'attribute-color', name: 'Xanh navy' },
      { id: 'attribute-color-black', attributeId: 'attribute-color', name: 'Đen' },
      { id: 'attribute-size-small', attributeId: 'attribute-size', name: 'S' },
      { id: 'attribute-size-medium', attributeId: 'attribute-size', name: 'M' },
      { id: 'attribute-size-large', attributeId: 'attribute-size', name: 'L' },
      { id: 'attribute-material-cotton', attributeId: 'attribute-material', name: 'Cotton' },
    ])
      await call('product.saveAttributeValue', { ...value, sequence: 10 })
    await call('stock.saveWarehouse', { id: 'wh', name: 'Kho Thành Phẩm', code: 'TP' })
    await call('stock.saveLocation', {
      id: 'inventory-adjustment',
      name: 'Điều chỉnh kiểm kê',
      usage: 'inventory',
    })
    await call('stock.adjustInventory', {
      id: 'inventory-count-seed',
      productId: 'variant-collab',
      locationId: 'wh:stock',
      inventoryLocationId: 'inventory-adjustment',
      countedQuantity: '18',
      productUomId: 'unit',
    })
    await call('stock.saveOrderpoint', {
      id: 'orderpoint-collab',
      productId: 'variant-collab',
      warehouseId: 'wh',
      locationId: 'wh:stock',
      trigger: 'manual',
      minQuantity: '40',
      maxQuantity: '50',
      replenishmentUomId: 'unit',
      routeId: 'wh:receipt-route',
    })
    await call('sale.createOrder', {
      id: 'quotation-collab',
      partnerId: 'member-party',
      warehouseId: 'wh',
      clientOrderRef: 'KH/2026/OPS',
      validityDate: '2026-08-31',
      notes: 'Báo giá mẫu dùng để kiểm chứng giao diện bán hàng.',
    })
    await call('sale.addLine', {
      id: 'quotation-collab:line',
      orderId: 'quotation-collab',
      productId: 'variant-collab',
      productUomQty: '3',
      productUomId: 'unit',
      priceUnit: '1250000',
    })
    await call('sale.createOrder', {
      id: 'sales-order-collab',
      partnerId: 'member-party',
      warehouseId: 'wh',
      clientOrderRef: 'KH/2026/CONFIRMED',
      notes: 'Đơn bán mẫu dùng để kiểm chứng danh sách đơn đã xác nhận.',
    })
    await call('sale.addLine', {
      id: 'sales-order-collab:line',
      orderId: 'sales-order-collab',
      productId: 'variant-collab',
      productUomQty: '4',
      productUomId: 'unit',
      priceUnit: '1250000',
    })
    await call('sale.confirmOrder', { id: 'sales-order-collab' })
    await call('sale.setInvoicePolicy', { templateId: 'tpl-collab', invoicePolicy: 'delivery' })
    await call('account.saveAccount', {
      id: 'account-receivable-collab',
      code: '131',
      name: 'Phải thu khách hàng',
      accountType: 'asset_receivable',
    })
    await call('account.saveAccount', {
      id: 'account-revenue-collab',
      code: '5111',
      name: 'Doanh thu bán hàng',
      accountType: 'income',
    })
    await call('account.saveJournal', {
      id: 'account-sales-collab',
      name: 'Bán hàng',
      code: 'SAL',
      type: 'sale',
    })
    await call('account.createInvoice', {
      id: 'invoice-collab',
      journalId: 'account-sales-collab',
      moveType: 'out_invoice',
      partnerId: 'member-party',
      invoiceDate: '2026-08-20T00:00:00.000Z',
      ref: 'INV/COLLAB/2026',
      description: 'Áo khoác vận hành',
      quantity: '4',
      priceUnit: '1250000',
      lineAccountId: 'account-revenue-collab',
      counterpartAccountId: 'account-receivable-collab',
    })
    await call('account.saveAccount', {
      id: 'account-payable-collab',
      code: '331',
      name: 'Phải trả nhà cung cấp',
      accountType: 'liability_payable',
    })
    await call('account.saveAccount', {
      id: 'account-expense-collab',
      code: '642',
      name: 'Chi phí vận hành',
      accountType: 'expense',
    })
    await call('account.saveJournal', {
      id: 'account-purchase-collab',
      name: 'Mua hàng',
      code: 'PUR',
      type: 'purchase',
    })
    await call('account.saveTax', {
      id: 'tax-sale-collab',
      name: 'VAT 10%',
      description: 'Thuế GTGT bán ra 10%',
      typeTaxUse: 'sale',
      taxScope: 'consu',
      amountType: 'percent',
      amount: '10',
      priceInclude: false,
      includeBaseAmount: false,
      sequence: 10,
    })
    await call('account.savePaymentTerm', {
      id: 'payment-term-collab',
      name: '30 ngày',
      note: 'Thanh toán toàn bộ sau 30 ngày.',
    })
    await call('account.savePaymentTermLine', {
      id: 'payment-term-line-collab',
      paymentId: 'payment-term-collab',
      value: 'percent',
      valueAmount: '100',
      delayType: 'days_after',
      nbDays: 30,
      sequence: 10,
    })
    await call('account.createInvoice', {
      id: 'vendor-bill-collab',
      journalId: 'account-purchase-collab',
      moveType: 'in_invoice',
      partnerId: 'member-party',
      invoiceDate: '2026-08-20T00:00:00.000Z',
      ref: 'BILL/COLLAB/2026',
      description: 'Chi phí vận hành tháng 8',
      quantity: '1',
      priceUnit: '3200000',
      lineAccountId: 'account-expense-collab',
      counterpartAccountId: 'account-payable-collab',
    })
    await call('account.saveJournal', {
      id: 'account-general-collab',
      name: 'Nghiệp vụ chung',
      code: 'MISC',
      type: 'general',
    })
    await call('account.createMove', {
      id: 'journal-entry-collab',
      journalId: 'account-general-collab',
      moveType: 'entry',
      date: '2026-08-20T00:00:00.000Z',
      ref: 'MISC/COLLAB/2026',
    })
    await call('account.addMoveLine', {
      id: 'journal-entry-collab-debit',
      moveId: 'journal-entry-collab',
      name: 'Chi phí vận hành',
      accountId: 'account-expense-collab',
      debit: '1800000',
      credit: '0',
    })
    await call('account.addMoveLine', {
      id: 'journal-entry-collab-credit',
      moveId: 'journal-entry-collab',
      name: 'Phải trả nhà cung cấp',
      accountId: 'account-payable-collab',
      debit: '0',
      credit: '1800000',
    })
    await call('account.saveAccount', {
      id: 'account-bank-collab',
      code: '1121',
      name: 'Tiền gửi ngân hàng',
      accountType: 'asset_cash',
    })
    await call('account.saveJournal', {
      id: 'account-bank-journal-collab',
      name: 'Ngân hàng',
      code: 'BNK',
      type: 'bank',
      defaultAccountId: 'account-bank-collab',
    })
    await call('account.registerPayment', {
      id: 'payment-collab',
      name: 'PAY/COLLAB/2026',
      paymentType: 'inbound',
      partnerType: 'customer',
      partnerId: 'member-party',
      journalId: 'account-bank-journal-collab',
      destinationAccountId: 'account-receivable-collab',
      amount: '1250000',
      date: '2026-08-20T00:00:00.000Z',
      memo: 'Khách hàng thanh toán một phần',
      paymentReference: 'BANK/COLLAB/2026',
    })
    await call('stock.createPicking', {
      id: 'pick-collab',
      name: 'TP/OUT/2026/0084',
      pickingTypeId: 'wh:outgoing',
      scheduledDate: '2026-08-21T02:00:00.000Z',
    })
    await call('stock.addMove', {
      id: 'move-collab',
      name: 'Áo khoác vận hành',
      pickingId: 'pick-collab',
      productId: 'variant-collab',
      productUomId: 'unit',
      productUomQty: '12',
    })
    await call('stock.createLot', {
      id: 'lot-collab',
      productId: 'variant-collab',
      name: 'LOT/2026/0084',
      ref: 'NCC-LOT-84',
      note: 'Lô kiểm chứng truy xuất và cộng tác.',
    })
    await call('stock.adjustInventory', {
      id: 'inventory-lot-seed',
      productId: 'variant-collab',
      locationId: 'wh:stock',
      inventoryLocationId: 'inventory-adjustment',
      countedQuantity: '12',
      lotId: 'lot-collab',
      productUomId: 'unit',
    })

    await call('product_mail_backend.follow', { targetId: 'tpl-collab' }, 'admin')
    await call('product_variant_mail_backend.follow', { targetId: 'variant-collab' }, 'admin')
    await call('stock_mail_backend.follow', { targetId: 'pick-collab' }, 'admin')
    await call('stock_lot_mail_backend.follow', { targetId: 'lot-collab' }, 'admin')
    await call('sale_mail_backend.follow', { targetId: 'quotation-collab' }, 'admin')
    await call('account_mail_backend.follow', { targetId: 'invoice-collab' }, 'admin')
    await call('product_mail_backend.follow', { targetId: 'tpl-collab' }, 'member')
    await call('product_variant_mail_backend.follow', { targetId: 'variant-collab' }, 'member')
    await call('stock_mail_backend.follow', { targetId: 'pick-collab' }, 'member')
    await call('stock_lot_mail_backend.follow', { targetId: 'lot-collab' }, 'member')
    await call('sale_mail_backend.follow', { targetId: 'quotation-collab' }, 'member')

    await call('activity.saveType', {
      id: 'activity-todo',
      name: 'Việc cần làm',
      category: 'todo',
      icon: 'check',
      defaultDelayDays: 0,
      chainingPolicy: 'none',
      sequence: 10,
      active: true,
    })
    await call('activity.saveType', {
      id: 'activity-call',
      name: 'Gọi điện',
      category: 'call',
      icon: 'phone',
      defaultDelayDays: 1,
      chainingPolicy: 'none',
      sequence: 20,
      active: true,
    })
    await call(
      'product_activity_backend.schedule',
      {
        id: 'activity-product-seed',
        targetId: 'tpl-collab',
        typeId: 'activity-todo',
        assigneeUserId: 'admin',
        summary: 'Xác nhận quy cách đóng gói',
        note: 'Đối chiếu mã vạch với tài liệu đã duyệt.',
        dueDate: '2026-08-20',
      },
      'admin',
    )
    await call(
      'product_variant_activity_backend.schedule',
      {
        id: 'activity-product-variant-seed',
        targetId: 'variant-collab',
        typeId: 'activity-todo',
        assigneeUserId: 'admin',
        summary: 'Kiểm tra mã vạch biến thể',
        note: 'Đối chiếu mã nội bộ và mã vạch trước khi mở bán.',
        dueDate: '2026-08-20',
      },
      'admin',
    )
    await call(
      'stock_activity_backend.schedule',
      {
        id: 'activity-stock-seed',
        targetId: 'pick-collab',
        typeId: 'activity-call',
        assigneeUserId: 'admin',
        summary: 'Gọi đơn vị vận chuyển',
        note: 'Xác nhận giờ lấy hàng tại cổng số 2.',
        dueDate: '2026-08-21',
      },
      'admin',
    )
    await call(
      'stock_lot_activity_backend.schedule',
      {
        id: 'activity-stock-lot-seed',
        targetId: 'lot-collab',
        typeId: 'activity-todo',
        assigneeUserId: 'admin',
        summary: 'Kiểm tra chứng từ lô hàng',
        note: 'Đối chiếu số lô với phiếu nhập kho.',
        dueDate: '2026-08-20',
      },
      'admin',
    )
    await call(
      'sale_activity_backend.schedule',
      {
        id: 'activity-sale-seed',
        targetId: 'quotation-collab',
        typeId: 'activity-call',
        assigneeUserId: 'admin',
        summary: 'Xác nhận thời gian giao hàng',
        note: 'Gọi khách hàng để chốt khung giờ nhận hàng.',
        dueDate: '2026-08-21',
      },
      'admin',
    )
    await call(
      'account_activity_backend.schedule',
      {
        id: 'activity-account-seed',
        targetId: 'invoice-collab',
        typeId: 'activity-todo',
        assigneeUserId: 'admin',
        summary: 'Kiểm tra hoá đơn trước khi ghi sổ',
        note: 'Đối chiếu khách hàng, số tiền và tài khoản doanh thu.',
        dueDate: '2026-08-21',
      },
      'admin',
    )

    await call(
      'calendar.saveEvent',
      {
        id: 'calendar-ops-review',
        name: 'Họp điều phối vận hành',
        description: 'Rà soát lịch xuất kho và tình trạng chuẩn bị hàng.',
        location: 'Phòng điều hành',
        allDay: false,
        startAt: '2026-08-20T03:00:00.000Z',
        stopAt: '2026-08-20T04:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
        privacy: 'public',
        showAs: 'busy',
        attendees: [{ partnerId: 'member-party' }],
        reminders: [],
        recurrence: { frequency: 'daily', interval: 1, count: 3 },
      },
      'admin',
    )
    await call(
      'calendar.saveEvent',
      {
        id: 'calendar-inventory-window',
        name: 'Khóa sổ kiểm kê tháng 8',
        description: 'Khoảng thời gian dành cho đối soát tồn kho.',
        allDay: true,
        startDate: '2026-08-22',
        stopDate: '2026-08-24',
        timezone: 'Asia/Ho_Chi_Minh',
        privacy: 'public',
        showAs: 'busy',
        attendees: [],
        reminders: [],
      },
      'admin',
    )

    await call('storage.createAttachment', {
      id: 'ops-spec',
      name: 'quy-cach-dong-goi.pdf',
      resModel: 'mail.Message',
      resId: 'product-message-1',
      kind: 'url',
      url: 'https://cdn.example.test/quy-cach-dong-goi.pdf',
      mimetype: 'application/pdf',
      size: 184320,
      public: false,
      createdAt: '2026-08-20T08:10:00.000Z',
    })
    await call(
      'product_mail_backend.post',
      {
        id: 'product-message-1',
        targetId: 'tpl-collab',
        kind: 'comment',
        body: 'Đã cập nhật quy cách đóng gói cho lô hàng tháng 8.',
        attachmentIds: ['ops-spec'],
      },
      'member',
    )
    await call(
      'product_mail_backend.post',
      {
        id: 'product-message-2',
        targetId: 'tpl-collab',
        kind: 'note',
        body: 'Ghi chú nội bộ: kiểm tra lại mã vạch trước khi phát hành.',
      },
      'admin',
    )
    await call(
      'product_variant_mail_backend.post',
      {
        id: 'product-variant-message-1',
        targetId: 'variant-collab',
        kind: 'comment',
        body: 'Đã xác nhận khối lượng và thể tích của biến thể.',
      },
      'member',
    )
    await call(
      'product_variant_mail_backend.post',
      {
        id: 'product-variant-message-2',
        targetId: 'variant-collab',
        kind: 'note',
        body: 'Ghi chú nội bộ: chờ kiểm tra mã vạch cuối cùng.',
      },
      'admin',
    )
    await call(
      'stock_mail_backend.post',
      {
        id: 'stock-message-1',
        targetId: 'pick-collab',
        kind: 'comment',
        body: 'Đội kho đã chuẩn bị đủ 12 sản phẩm, chờ bàn giao vận chuyển.',
      },
      'member',
    )
    await call(
      'stock_mail_backend.post',
      {
        id: 'stock-message-2',
        targetId: 'pick-collab',
        kind: 'note',
        body: 'Ghi chú nội bộ: ưu tiên lấy hàng ở kệ A-03.',
      },
      'admin',
    )
    await call(
      'stock_lot_mail_backend.post',
      {
        id: 'stock-lot-message-1',
        targetId: 'lot-collab',
        kind: 'comment',
        body: 'Đã đối chiếu số lô với chứng từ nhập hàng.',
      },
      'member',
    )
    await call(
      'stock_lot_mail_backend.post',
      {
        id: 'stock-lot-message-2',
        targetId: 'lot-collab',
        kind: 'note',
        body: 'Ghi chú nội bộ: giữ mẫu kiểm tra tại kệ A-01.',
      },
      'admin',
    )
    await call(
      'sale_mail_backend.post',
      {
        id: 'sale-message-1',
        targetId: 'quotation-collab',
        kind: 'comment',
        body: 'Khách hàng đã xác nhận số lượng và địa điểm giao hàng.',
      },
      'member',
    )
    await call(
      'sale_mail_backend.post',
      {
        id: 'sale-message-2',
        targetId: 'quotation-collab',
        kind: 'note',
        body: 'Ghi chú nội bộ: kiểm tra hạn báo giá trước khi gửi.',
      },
      'admin',
    )
    await call(
      'account_mail_backend.post',
      {
        id: 'account-message-1',
        targetId: 'invoice-collab',
        kind: 'note',
        body: 'Ghi chú nội bộ: đối chiếu điều khoản thanh toán trước khi ghi sổ.',
      },
      'admin',
    )
    await call(
      'mail_transport.saveTemplate',
      {
        id: 'template-ops-update',
        name: 'Cập nhật vận hành',
        fromAddress: 'van-hanh@acme.example.test',
        fromName: 'KetSuite Operations',
        replyTo: 'dieu-phoi@acme.example.test',
        subjectTemplate: '{{ document.name }} — {{ status }}',
        textTemplate: 'Xin chào {{ recipient.name }}, {{ document.name }} hiện ở trạng thái {{ status }}.',
        htmlTemplate:
          '<p>Xin chào <strong>{{ recipient.name }}</strong>,</p><p>{{ document.name }} hiện ở trạng thái {{ status }}.</p>',
        allowedKeys: ['document.name', 'recipient.name', 'status'],
        active: true,
      },
      'admin',
    )
    await call(
      'mail_transport.queueTemplate',
      {
        id: 'delivery-ops-sent',
        templateId: 'template-ops-update',
        context: {
          document: { name: 'TP/OUT/2026/0084' },
          recipient: { name: 'Trần Điều Phối' },
          status: 'sẵn sàng bàn giao',
        },
        to: [{ address: 'member-party@example.test', name: 'Trần Điều Phối' }],
        messageId: 'stock-message-1',
      },
      'admin',
    )
    await call(
      'mail_transport.queueTemplate',
      {
        id: 'delivery-ops-failed',
        templateId: 'template-ops-update',
        context: {
          document: { name: 'Áo khoác vận hành' },
          recipient: { name: 'Bộ phận mua hàng' },
          status: 'chờ duyệt quy cách',
        },
        to: [{ address: 'invalid-mailbox@example.test', name: 'Bộ phận mua hàng' }],
        messageId: 'product-message-1',
      },
      'admin',
    )
    // Evidence-only provider outcomes. The real state machine is exercised by
    // test/mail-transport.test.ts; this fixture keeps the screenshot deterministic.
    await e2e.fixture.withTenant('', async ({ adapter }) => {
      const p = (position: number) => (adapter.name === 'postgres' ? `$${position}` : '?')
      await adapter.run(
        `UPDATE mail_transport_delivery
         SET state = 'sent', attempts = 1, "providerMessageId" = ${p(1)}, "acceptedAt" = ${p(2)}, "sentAt" = ${p(3)}, "updatedAt" = ${p(4)}
         WHERE id = ${p(5)}`,
        [
          'memory:delivery-ops-sent',
          '2026-08-20T09:00:00.000Z',
          '2026-08-20T09:00:00.000Z',
          '2026-08-20T09:00:00.000Z',
          'delivery-ops-sent',
        ],
      )
      await adapter.run(
        `UPDATE mail_transport_delivery
         SET state = 'failed', attempts = 5, "lastError" = ${p(1)}, "updatedAt" = ${p(2)}
         WHERE id = ${p(3)}`,
        ['550 5.1.1 Recipient mailbox does not exist', '2026-08-20T09:02:00.000Z', 'delivery-ops-failed'],
      )
    })
    await call(
      'mail_inbound.receiveReply',
      {
        provider: 'evidence',
        providerEventId: 'reply-accepted',
        kind: 'message',
        fromAddress: 'carrier@example.test',
        recipients: ['operations@acme.example.test'],
        subject: 'Re: TP/OUT/2026/0084',
        text: 'Đơn vị vận chuyển xác nhận lấy hàng lúc 15:30.',
        references: ['memory:delivery-ops-sent'],
        attachments: [],
        receivedAt: '2026-08-20T09:10:00.000Z',
      },
      null,
    )
    await call(
      'mail_inbound.receiveReply',
      {
        provider: 'evidence',
        providerEventId: 'reply-invalid-token',
        kind: 'message',
        fromAddress: 'unknown@example.test',
        recipients: ['reply@acme.example.test'],
        text: 'Email không được phép định tuyến bằng reference dự phòng.',
        replyToken: 'invalid-reply-token',
        references: ['memory:delivery-ops-sent'],
        attachments: [],
        receivedAt: '2026-08-20T09:11:00.000Z',
      },
      null,
    )
    await call(
      'mail_inbound.receiveReply',
      {
        provider: 'evidence',
        providerEventId: 'bounce-unmatched',
        kind: 'bounce',
        recipients: ['bounce@acme.example.test'],
        text: '550 unknown provider reference',
        references: ['missing-provider-message'],
        attachments: [],
        receivedAt: '2026-08-20T09:12:00.000Z',
      },
      null,
    )
    await call(
      'mail_inbound.saveAlias',
      {
        id: 'alias-receipts',
        localPart: 'receipts',
        name: 'Thông báo nhập kho',
        bridge: 'stock.receipt',
        defaults: { pickingTypeId: 'wh:incoming' },
        active: true,
      },
      'admin',
    )
    await call(
      'stock_mail_inbound.receive',
      {
        provider: 'evidence',
        providerEventId: 'stock-asn-0085',
        kind: 'message',
        fromAddress: 'supplier@example.test',
        recipients: ['receipts@acme.example.test'],
        subject: 'ASN nhà cung cấp 2026-0085',
        text: 'Lô bổ sung 8 áo khoác sẽ đến kho vào sáng mai.',
        alias: 'receipts',
        attachments: [],
        receivedAt: '2026-08-20T09:13:00.000Z',
      },
      null,
    )
    return e2e
  } catch (error) {
    await e2e.close()
    throw error
  }
}
