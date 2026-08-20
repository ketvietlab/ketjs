import { defineModule } from 'ketjs'
import { functions } from './functions.ts'
import { menus } from './menus.ts'
import { messages } from './messages.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'hospitality_core',
  version: '0.1.0',
  depends: ['backend', 'storage'],
  app: true,
  title: 'Khách sạn',
  summary: 'Cơ sở lưu trú, loại phòng, phòng, tiện nghi và chính sách vận hành.',
  category: 'Khách sạn',
  models,
  relations,
  functions,
  routes,
  menus,
  messages,
})

export {
  ACCOMMODATION_TYPES,
  AMENITY_SCOPES,
  BED_TYPES,
  CANCELLATION_POLICY_TYPES,
  CONTACT_TYPES,
  ROOM_STATUSES,
} from './types.ts'
export type {
  AccommodationType,
  AmenityScope,
  BedType,
  CancellationPolicyType,
  ContactType,
  RoomStatus,
} from './types.ts'
