// Deterministic synthetic organization. Used by Atlas, never imported by product code.
const date = (offset) => new Date(Date.UTC(2026, 8, 22 + offset)).toISOString().slice(0, 10)
const names = [
  'Nguyễn Minh Linh',
  'Phạm Hoàng Nam',
  'Trần Ngọc Anh',
  'Lê Thanh Tùng',
  'Võ Bảo Ngọc',
  'Đặng Minh Đức',
  'Đỗ Hải Yến',
  'Bùi Quang Huy',
  'Nguyễn Thảo Vy',
  'Phan Tuấn Kiệt',
  'Hoàng Gia Hân',
  'Trịnh Đức Long',
  'Dương Khánh An',
  'Mai Nhật Minh',
  'Lý Thu Trang',
  'Vũ Minh Châu',
  'Hồ Anh Khoa',
  'Đinh Phương Thảo',
  'Cao Quốc Việt',
  'Ngô Hải Đăng',
]
const domains = [
  ['core', 'KV', 'KetSuite Core', 'product', 'Đặt phòng', 'Tồn phòng', 'Bảng giá', 'Thanh toán'],
  [
    'ops',
    'OPS',
    'Vận hành nội bộ',
    'operations',
    'Bàn giao ca',
    'Đối soát',
    'Tiếp nhận sự cố',
    'Phân công trực',
  ],
  [
    'docs',
    'DOC',
    'Tài liệu khách hàng',
    'product',
    'Hướng dẫn bắt đầu',
    'Tài liệu tích hợp',
    'Quyền truy cập',
    'Ghi chú phát hành',
  ],
  [
    'mobile',
    'MOB',
    'Ứng dụng di động',
    'product',
    'Đăng nhập',
    'Thông báo đẩy',
    'Lịch ngoại tuyến',
    'Hồ sơ người dùng',
  ],
  [
    'billing',
    'BILL',
    'Thanh toán và hóa đơn',
    'product',
    'Hóa đơn điện tử',
    'Hoàn tiền',
    'Gói dịch vụ',
    'Đối chiếu giao dịch',
  ],
  [
    'integrations',
    'INT',
    'Tích hợp đối tác',
    'product',
    'Webhook',
    'Đồng bộ khách hàng',
    'Nhập dữ liệu',
    'Khóa API',
  ],
  [
    'support',
    'SUP',
    'Chăm sóc khách hàng',
    'operations',
    'Phân loại yêu cầu',
    'Cam kết phản hồi',
    'Hướng dẫn xử lý',
    'Khảo sát hài lòng',
  ],
  [
    'security',
    'SEC',
    'An toàn và quyền truy cập',
    'product',
    'Nhật ký truy cập',
    'Xác thực hai bước',
    'Phân quyền nhóm',
    'Thu hồi phiên',
  ],
  [
    'analytics',
    'DATA',
    'Báo cáo và dữ liệu',
    'product',
    'Báo cáo doanh thu',
    'Chất lượng dữ liệu',
    'Xuất báo cáo',
    'Chỉ số vận hành',
  ],
  [
    'research',
    'LAB',
    'Nghiên cứu trải nghiệm',
    'lab',
    'Phỏng vấn người dùng',
    'Thử nghiệm điều hướng',
    'Đánh giá khả dụng',
    'Tìm kiếm thông minh',
  ],
]
const actions = [
  'Xác định tiêu chí nghiệm thu',
  'Thiết kế luồng thao tác',
  'Triển khai trường hợp chính',
  'Bổ sung kiểm tra dữ liệu',
  'Xử lý trường hợp đồng thời',
  'Kiểm tra quyền truy cập',
  'Tối ưu thời gian phản hồi',
  'Kiểm thử trên thiết bị nhỏ',
  'Cập nhật hướng dẫn sử dụng',
  'Đối soát dữ liệu chuyển đổi',
  'Xác nhận kết quả bàn giao',
  'Theo dõi sau phát hành',
]
export function expandRealisticFixtures(d, scenario, hooks) {
  // Explicit recovery/empty fixtures must retain their original meaning.
  if (scenario === 'empty' || hooks?.first('skipRealistic', scenario)) return
  const prefix = d.company.id === 'demo' ? '' : d.company.id + '-'
  names.forEach((name, i) => {
    d.members.push({
      id: 'person-' + i,
      name,
      email: `person${i + 1}@example.test`,
      role: 'member',
      status: 'active',
    })
  })
  d.people = d.members.filter((m) => m.role !== 'guest').map((m) => m.name)
  d.teams[0].memberIds.push(...names.map((_, i) => 'person-' + i).filter((_, i) => i % 3 !== 0))
  d.teams[1].memberIds.push(...names.map((_, i) => 'person-' + i).filter((_, i) => i % 3 === 0))
  const generated = []
  domains.forEach(([key, code, title, workspace, ...subjects], p) => {
    const projectId = prefix + key
    let project = d.projects.find((x) => x.id === projectId)
    if (!project) {
      project = {
        id: projectId,
        code,
        title,
        description: `Kế hoạch quý III–IV: ${subjects.join(', ')}.`,
        companyId: d.company.id,
        workspaceId: prefix + workspace,
        access: 'workspace',
        members: [],
        tags: [],
        progress: 0,
      }
      d.projects.push(project)
    }
    const team = workspace === 'operations' ? d.teams[1] : d.teams[0]
    const pool = d.members.filter((m) => team.memberIds.includes(m.id))
    project.members = pool.map((m) => m.name)
    d.grants.push({
      id: 'fixture-access-' + key,
      scope: 'project',
      targetId: projectId,
      subjectType: 'team',
      subjectId: team.id,
      role: 'editor',
    })
    const sprintIds = []
    for (let s = 0; s < 3; s++) {
      const id = prefix + key + '-iteration-' + s
      sprintIds.push(id)
      d.sprints.push({
        id,
        projectId,
        title: `${code} · Sprint ${11 + s}`,
        description: `Hoàn thiện ${subjects[s]} và kiểm tra trước bàn giao.`,
        start: date(-15 + s * 14),
        end: date(-2 + s * 14),
        state: ['completed', 'active', 'planned'][s],
      })
    }
    subjects.forEach((subject, j) => {
      d.epics.push({
        id: prefix + key + '-epic-' + j,
        projectId,
        title: subject,
        description: `Đầu ra và chất lượng cho ${subject.toLowerCase()}.`,
        progress: 0,
      })
    })
    for (let i = 0; i < 48; i++) {
      const subject = subjects[Math.floor(i / 12)],
        action = actions[i % 12],
        status = ['todo', 'progress', 'progress', 'review', 'done', 'done', 'done', 'todo'][i % 8]
      const count = [1, 1, 2, 3, 1, 5, 0, 1][i % 8],
        owners = Array.from({ length: count }, (_, n) => pool[(i + p + n) % pool.length])
      const dueOffset = status === 'done' ? -15 + (i % 13) : -8 + (i % 29),
        undated = i % 13 === 0
      const id = prefix + code + '-' + (200 + i),
        points = [1, 2, 3, 5, 8][i % 5]
      const task = {
        id,
        projectId,
        title: `${subject}: ${action.toLowerCase()}`,
        status,
        priority: ['normal', 'normal', 'high', 'normal', 'normal', 'urgent'][i % 6],
        assignee: owners[0]?.name ?? '',
        assigneeIds: owners.map((m) => m.id),
        dueDate: undated ? '' : date(dueOffset),
        due: undated ? '' : date(dueOffset).slice(8) + '/' + date(dueOffset).slice(5, 7),
        startDate: undated ? '' : date(dueOffset - 3 - (i % 5)),
        points,
        version: 1,
        order: d.tasks.length,
        blockedBy: [],
        parentId: null,
        archived: i === 46,
        followed: i % 11 === 0,
        tags: [['tech', 'risk', 'release'][i % 3]],
        sprint: d.sprints.find((s) => s.id === sprintIds[status === 'done' ? 0 : i % 3 === 0 ? 2 : 1]).title,
        epic: prefix + key + '-epic-' + Math.floor(i / 12),
        description: `${action} cho ${subject.toLowerCase()} trong dự án ${title}.\n\nPhạm vi\nKiểm tra dữ liệu hiện có, thao tác chính và trường hợp không đủ quyền.\n\nTiêu chí nghiệm thu\n• Kết quả đúng với dữ liệu đối chiếu.\n• Có bằng chứng kiểm thử và hướng dẫn khôi phục.\n• Người nhận xác nhận trước khi đóng công việc.`,
      }
      // Acyclic blockers, confined to open work. Historical accepted work stays unblocked.
      if (i > 0 && status === 'todo' && i % 7 === 0) task.blockedBy = [prefix + code + '-' + (199 + i)]
      d.tasks.push(task)
      generated.push(task)
      hooks?.notify('realisticTask', { d, task, id, count, owners, pool, status, points, dueOffset, i, date })
      const actor = owners[0] ?? pool[0]
      for (let h = 0; h < 3; h++)
        d.history.push({
          id: id + '-history-' + h,
          taskId: id,
          actorId: actor.id,
          person: actor.name,
          time: date(-22 + h) + 'T09:00:00Z',
          version: 1,
          changes: [],
          text: [
            'Thống nhất phạm vi và tiêu chí nghiệm thu.',
            'Cập nhật kế hoạch triển khai và dữ liệu đối chiếu.',
            'Bổ sung hướng dẫn kiểm tra trước bàn giao.',
          ][h],
        })
      if (i % 2 === 0)
        d.comments.push({
          id: id + '-comment',
          taskId: id,
          person: pool[(i + 1) % pool.length].name,
          text: `Đã kiểm tra ${subject.toLowerCase()}. Vui lòng đính kèm kết quả đối chiếu trước khi gửi bàn giao.`,
          time: date(-3) + ' · 14:30',
        })
    }
    for (let j = 0; j < 6; j++)
      d.pages.push({
        id: prefix + key + '-doc-' + j,
        projectId,
        parentId: j > 1 ? prefix + key + '-doc-0' : null,
        title: [
          `Tổng quan ${title}`,
          'Quyết định thiết kế',
          'Hướng dẫn kiểm thử',
          'Quy trình bàn giao',
          'Kế hoạch phát hành',
          'Tổng kết vận hành',
        ][j],
        content: `${title}\n\nPhạm vi\n${subjects.join('; ')}.\n\nQuy trình\n1. Xác nhận người phụ trách và thời hạn.\n2. Kiểm tra dữ liệu, quyền truy cập và tình huống lỗi.\n3. Gắn bằng chứng vào công việc trước khi bàn giao.\n\nKết quả\nTheo dõi công việc của dự án để kiểm tra tiến độ và quyết định nghiệm thu.`,
        version: 1,
        visibility: j === 5 ? 'private' : 'shared',
        ownerId: pool[0].id,
        readerIds: [],
        history: [],
      })
    const tasks = d.tasks.filter((t) => t.projectId === projectId && !t.archived)
    project.progress = Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100)
  })
  generated
    .filter((_, i) => i % 6 === 0)
    .forEach((t, i) => {
      d.inbox.push({
        id: t.id + '-notification',
        taskId: t.id,
        actorId: t.assigneeIds[0] ?? 'bao',
        recipientId: 'mai',
        kind: 'mention',
        title: 'Bạn được nhắc trong thảo luận',
        description: t.title,
        read: i % 3 !== 0,
        actionNeeded: false,
        route: 'issue',
        createdAt: date(-Math.floor(i / 8)) + 'T08:30:00Z',
      })
    })
  d.fixtureProfile = { id: 'realistic', anchorDate: '2026-09-22', synthetic: true }
}
