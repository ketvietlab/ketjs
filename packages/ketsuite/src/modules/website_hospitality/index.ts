import { defineModule } from '@ketvietlab/ketjs'
import { contentTypes } from './content-types.ts'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { sections } from './sections.ts'
import { routes } from './routes.ts'
import { channelRoutes } from './channel-routes.ts'

export default defineModule({
  name: 'website_hospitality',
  version: '0.1.0',
  app: true,
  depends: ['website', 'hospitality_core', 'channel_api'],
  compatible: { channel_api: '^1' },
  title: 'Website Hospitality',
  summary: 'Nội dung hạng phòng và luồng yêu cầu đặt phòng cho website lưu trú.',
  category: 'Website',
  messages: {
    vi: {
      'app.title': 'Website Hospitality',
      'app.summary': 'Nội dung hạng phòng và luồng yêu cầu đặt phòng cho website lưu trú.',
      'app.category': 'Website',
      'content.stay': 'Hạng phòng',
      'content.stays': 'Các hạng phòng',
      'section.stays': 'Danh sách hạng phòng',
      'section.booking': 'Yêu cầu đặt phòng',
      'error.invalidSite': 'Website không thuộc ngành hospitality hoặc đang tạm dừng.',
      'error.propertyNotFound': 'Không tìm thấy cơ sở lưu trú.',
      'error.duplicateProperty': 'Cơ sở lưu trú đã được gán cho website.',
      'error.roomTypeNotFound': 'Hạng phòng không khả dụng trên website này.',
      'error.invalidStayDates': 'Ngày lưu trú không hợp lệ, quá dài hoặc ngoài thời gian cho phép.',
      'error.invalidName': 'Tên khách không hợp lệ hoặc quá dài.',
      'error.invalidEmail': 'Địa chỉ email không hợp lệ.',
      'error.invalidPhone': 'Số điện thoại không hợp lệ.',
      'error.noteTooLong': 'Ghi chú vượt quá giới hạn cho phép.',
      'error.invalidGuests': 'Số lượng khách không hợp lệ.',
      'error.capacityExceeded': 'Số khách vượt quá sức chứa của hạng phòng.',
      'error.requestConflict': 'Yêu cầu vừa được xử lý. Vui lòng kiểm tra lại.',
      'error.rateLimit': 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',
    },
    en: {
      'app.title': 'Hospitality website',
      'app.summary': 'Room-type content and booking enquiries for hospitality sites.',
      'app.category': 'Website',
      'content.stay': 'Stay',
      'content.stays': 'Stays',
      'section.stays': 'Stay listing',
      'section.booking': 'Booking enquiry',
      'error.invalidSite': 'The site is not an active hospitality site.',
      'error.propertyNotFound': 'The property was not found.',
      'error.duplicateProperty': 'The property is already assigned to this site.',
      'error.roomTypeNotFound': 'The room type is not available on this site.',
      'error.invalidStayDates': 'The stay dates are invalid, too long or outside the allowed horizon.',
      'error.invalidName': 'The guest name is invalid or too long.',
      'error.invalidEmail': 'The email address is invalid.',
      'error.invalidPhone': 'The phone number is invalid.',
      'error.noteTooLong': 'The note exceeds the allowed length.',
      'error.invalidGuests': 'The guest count is invalid.',
      'error.capacityExceeded': 'The guest count exceeds the room capacity.',
      'error.requestConflict': 'The request was processed concurrently. Please check again.',
      'error.rateLimit': 'Too many booking requests. Please try again later.',
    },
  },
  models,
  functions,
  contentTypes,
  sections,
  routes: { ...routes, ...channelRoutes },
})
