import { defineModule } from 'ketjs'
import { contentTypes } from './content-types.ts'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { sections } from './sections.ts'

export default defineModule({
  name: 'website_hospitality',
  version: '0.1.0',
  app: true,
  depends: ['website', 'hospitality_core'],
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
    },
    en: {
      'app.title': 'Hospitality website',
      'app.summary': 'Room-type content and booking enquiries for hospitality sites.',
      'app.category': 'Website',
      'content.stay': 'Stay',
      'content.stays': 'Stays',
      'section.stays': 'Stay listing',
      'section.booking': 'Booking enquiry',
    },
  },
  models,
  functions,
  contentTypes,
  sections,
})
