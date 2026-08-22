---
title: Hospitality to Website handoff
description: Internal integration contract between the KetSuite Hospitality and Website teams.
pagefind: false
---

# Hospitality → Website handoff

Trạng thái: sẵn sàng để team Website tích hợp BFF. Hospitality không mở HTTP route công khai và không phụ thuộc ngược vào module Website.

## Mốc bàn giao

- Catalog/content: PR #149, commit `68d989de5febc63c5446bf18e04e652ceac9c723`.
- Quote, booking và self-service reservation: commit `9bcfa37375a96b93fad022f6873a6147e9980332`.
- Tất cả chín hàm dưới đây có `exposure: 'internal'`. BFF là biên tin cậy duy nhất được phép gọi chúng.
- BFF phải lấy `partnerId` từ customer session, chọn company/property từ cấu hình site, rồi gọi bằng context có đúng company scope. Không nhận `partnerId`, company hoặc giá từ trình duyệt.

## Contract catalog và content

### `hospitality_core.listPropertyCatalog`

Input:

```ts
// File: packages/ketsuite/src/modules/hospitality_core/catalog.ts
{
  propertyIds?: string[]
  active?: boolean
  limit?: number       // mặc định 50, tối đa 200
  offset?: number      // mặc định 0, tối đa 100000
}
```

Output: `PropertyCatalog[]`.

### `hospitality_core.getPropertyCatalog`

Input: `{ id: string }`.

Output: `PropertyCatalog | null`. Chỉ trả cơ sở đang hoạt động.

```ts
// File: packages/ketsuite/src/modules/hospitality_core/catalog.ts
type CatalogImage = {
  attachmentId: string
  category: string
  caption: string | null
}

type CatalogAmenity = {
  id: string
  categoryId: string | null
  code: string
  name: string
}

type PropertyCatalog = {
  id: string
  companyId: string
  branchId: string | null
  code: string
  name: string
  publicName: string | null
  accommodationType: string
  timezone: string
  starRating: number
  addressLine: string | null
  locality: string | null
  countryCode: string | null
  latitude: string | null
  longitude: string | null
  description: string | null
  houseRules: string | null
  childrenStayFree: boolean
  minimumGuestAge: number | null
  active: boolean
  primaryImage: CatalogImage | null
  amenities: CatalogAmenity[]
}
```

### `hospitality_core.listRoomTypeCatalog`

Input:

```ts
// File: packages/ketsuite/src/modules/hospitality_core/catalog.ts
{
  propertyId: string
  roomTypeIds?: string[]
  active?: boolean
  published?: boolean
  limit?: number
  offset?: number
}
```

Output: `RoomTypeCatalog[]`. Mặc định chỉ trả loại phòng active và published.

### `hospitality_core.getRoomTypeCatalog`

Input: `{ id: string }`.

Output: `RoomTypeCatalog | null`. Loại phòng và cơ sở đều phải đang hoạt động; loại phòng phải published.

```ts
// File: packages/ketsuite/src/modules/hospitality_core/catalog.ts
type RoomTypeCatalog = {
  id: string
  companyId: string
  propertyId: string
  code: string
  name: string
  publicName: string | null
  description: string | null
  defaultCapacity: number
  maxAdults: number
  maxChildren: number
  maxInfants: number
  maxExtraBeds: number
  sizeSqm: string | null
  viewType: string | null
  sharedBathroom: boolean
  baseRate: string
  active: boolean
  published: boolean
  primaryImage: CatalogImage | null
  images: CatalogImage[]
  amenities: CatalogAmenity[]
  beds: Array<{ type: string; quantity: number; roomName: string | null }>
}
```

Catalog chỉ trả attachment ID và metadata an toàn. BFF dùng Storage contract để đổi attachment thành URL phù hợp; Hospitality không phát URL phụ thuộc backend lưu trữ.

## Contract quote và booking

### `hospitality_core.quoteAvailability`

Input:

```ts
// File: packages/ketsuite/src/modules/hospitality_core/online-booking.ts
{
  propertyId: string
  roomTypeId?: string
  checkIn: string       // YYYY-MM-DD theo timezone cơ sở
  checkOut: string      // YYYY-MM-DD, exclusive
  adults: number
  children?: number
  infants?: number
  quantity?: number     // mặc định 1, tối đa 10
  ratePlanId?: string
}
```

Không có trường giá ở input. Giá, currency, sức chứa, restriction và inventory đều được tính lại phía server.

```ts
// File: packages/ketsuite/src/modules/hospitality_core/online-booking.ts
type QuoteResult =
  | {
      ok: true
      propertyId: string
      companyId: string
      checkIn: string
      checkOut: string
      nights: number
      items: Array<{
        roomTypeId: string
        ratePlanId: string | null
        availableQuantity: number
        requestedQuantity: number
        unitRate: string
        amountTotal: string
        currency: string
        restrictions: {
          minStay: number | null
          maxStay: number | null
          closedToArrival: boolean
          closedToDeparture: boolean
          stopSell: boolean
        }
      }>
      errors: []
    }
  | { ok: false; errors: BookingIssue[] }
```

Giới hạn hiện tại: đặt trước tối đa 366 ngày, tối đa 90 đêm và 10 phòng/lần.

### `hospitality_core.createOnlineReservation`

Input:

```ts
// File: packages/ketsuite/src/modules/hospitality_core/online-booking.ts
{
  id: string             // ID ổn định do BFF sinh
  requestKey: string     // idempotency key ổn định của checkout
  propertyId: string
  roomTypeId: string
  ratePlanId?: string
  partnerId: string      // BFF lấy từ customer session
  checkIn: string
  checkOut: string
  adults: number
  children?: number
  infants?: number
  quantity?: number
  channelRef?: string
  createdAt?: string     // chỉ dành cho import/test tin cậy
}
```

Output:

```ts
// File: packages/ketsuite/src/modules/hospitality_core/online-booking.ts
type CreateReservationResult =
  | {
      ok: true
      id: string
      companyId: string
      propertyId: string
      roomTypeId: string
      folioId: string
      stayId: string | null
      code: string
      state: string
      rate: string
      quantity: number
      amountTotal: string
      currency: string
      existing: boolean
      errors: []
    }
  | { ok: false; errors: BookingIssue[] }
```

Cùng `requestKey` và cùng nội dung trả bản ghi cũ với `existing: true`. Cùng key nhưng nội dung khác trả `requestConflict`. Không retry bằng key mới khi client chưa biết kết quả lần trước.

## Contract self-service reservation

### `hospitality_core.listPartnerReservations`

Input:

```ts
// File: packages/ketsuite/src/modules/hospitality_core/online-booking.ts
{
  partnerId: string
  propertyIds?: string[]
  state?: string
  from?: string          // datetime; overlap với kỳ lưu trú
  to?: string            // datetime; exclusive
  limit?: number         // mặc định 50, tối đa 200
  offset?: number
}
```

Output: `PartnerReservation[]`.

### `hospitality_core.getPartnerReservation`

Input: `{ id: string; partnerId: string }`.

Output: `{ ok: true; reservation: PartnerReservation; errors: [] }` hoặc lỗi ownership.

```ts
// File: packages/ketsuite/src/modules/hospitality_core/online-booking.ts
type PartnerReservation = {
  id: string
  companyId: string
  code: string
  propertyId: string
  roomTypeId: string
  checkIn: string
  checkOut: string
  adults: number
  children: number
  amountTotal: string
  currency: string
  state: string
  cancellationAllowed: boolean
}
```

Projection này cố ý không trả giấy tờ, contact PII nội bộ, charge detail hoặc field vận hành.

### `hospitality_core.cancelPartnerReservation`

Input: `{ id: string; partnerId: string; reason?: string; at?: string }`.

Output:

```ts
// File: packages/ketsuite/src/modules/hospitality_core/online-booking.ts
type CancelReservationResult =
  | { ok: true; id: string; state: 'cancelled'; existing: boolean; errors: [] }
  | { ok: false; errors: BookingIssue[] }
```

Hủy chỉ áp dụng cho reservation `confirmed`, trước check-in và còn trong cửa sổ hủy miễn phí; chính sách `non_refundable` luôn bị từ chối. Retry sau khi đã hủy trả `existing: true`.

## Lỗi ổn định và i18n

```ts
// File: packages/ketsuite/src/modules/hospitality_core/online-booking.ts
type BookingIssue = {
  field: string
  code: string
  messageKey: `hospitality_core.error.${string}`
  params?: Record<string, unknown>
}
```

| code | Tiếng Việt | English |
| --- | --- | --- |
| `propertyNotFound` | Không tìm thấy cơ sở lưu trú đang hoạt động trong công ty hiện tại. | No active property was found in the current company. |
| `roomTypeNotFound` | Không tìm thấy loại phòng đang được mở bán. | No active, published room type was found. |
| `propertyMismatch` | Loại phòng không thuộc cơ sở lưu trú đã chọn. | The room type does not belong to the selected property. |
| `capacityExceeded` | Số khách vượt quá sức chứa của số phòng đã chọn. | The guest count exceeds the capacity of the requested rooms. |
| `invalidStayDates` | Ngày nhận và trả phòng không hợp lệ. | The check-in and check-out dates are invalid. |
| `pastStayDate` | Không thể đặt phòng với ngày nhận phòng trong quá khứ. | A reservation cannot start in the past. |
| `bookingHorizonExceeded` | Chỉ có thể đặt phòng trước tối đa `{days}` ngày. | Reservations can be made at most `{days}` days ahead. |
| `stayLengthExceeded` | Một lần đặt trực tuyến không được vượt quá `{nights}` đêm. | An online reservation cannot exceed `{nights}` nights. |
| `invalidQuantity` | Số phòng phải nằm trong giới hạn cho phép, tối đa `{maximum}` phòng. | Room quantity is outside the allowed range of up to `{maximum}`. |
| `invalidGuestCount` | Số lượng người lớn, trẻ em hoặc trẻ sơ sinh không hợp lệ. | The adult, child or infant count is invalid. |
| `inventoryUnavailable` | Không còn đủ phòng cho toàn bộ kỳ lưu trú. | There is not enough inventory for the complete stay. |
| `ratePlanUnavailable` | Giá bán đã chọn không còn khả dụng. | The selected rate plan is no longer available. |
| `stopSell` | Cơ sở đang dừng bán trong kỳ lưu trú đã chọn. | Sales are stopped during the selected stay. |
| `closedToArrival` | Không nhận khách vào ngày nhận phòng đã chọn. | Arrival is closed on the selected check-in date. |
| `closedToDeparture` | Không trả phòng vào ngày đã chọn. | Departure is closed on the selected check-out date. |
| `minimumStay` | Giá hoặc hạn chế bán yêu cầu tối thiểu `{required}` đêm. | The rate or sales restriction requires at least `{required}` nights. |
| `maximumStay` | Giá hoặc hạn chế bán cho phép tối đa `{maximum}` đêm. | The rate or sales restriction allows at most `{maximum}` nights. |
| `requestConflict` | Khóa yêu cầu đã được dùng cho một nội dung đặt phòng khác. | The request key was already used for a different reservation. |
| `partnerNotFound` | Không tìm thấy hồ sơ khách hàng trong công ty hiện tại. | The customer record was not found in the current company. |
| `reservationNotOwned` | Không tìm thấy đặt phòng thuộc khách hàng này. | No reservation owned by this customer was found. |
| `cancellationNotAllowed` | Đặt phòng không còn đủ điều kiện hủy trực tuyến. | This reservation is no longer eligible for online cancellation. |

BFF nên trả `code`, `messageKey` và `params`, còn Website dịch tại presentation layer. Không parse chuỗi message.

## Transaction, concurrency và dữ liệu tạo ra

Một booking thành công tạo trong cùng một transaction:

- một `Folio` mở;
- một `Reservation` confirmed, provider `website`;
- một `Stay` draft và một `StayGuest` chính;
- một room `Charge`;
- inventory ledger và `InventoryChange` tương ứng cho toàn bộ số phòng và đêm.

Inventory được reserve bằng compare-and-set. Hai request tranh phòng cuối chỉ có một request thắng trên cả SQLite và PostgreSQL. Nếu transaction lỗi, không có folio/reservation/stay/charge/inventory dở dang. Unique key `(companyId, provider, requestKey)` xử lý retry qua nhiều replica. Hủy dùng compare-and-set, void charge và trả đúng `roomQuantity` vào inventory trong cùng transaction.

SQLite adapter tuần tự hóa transaction trong một process vì `node:sqlite` dùng một connection đồng bộ. PostgreSQL vẫn dùng transaction connection riêng và xử lý tranh chấp thực giữa nhiều adapter/process.

## Kiểm chứng bàn giao

- `npm run verify`: 791 tests; 790 pass, 1 MinIO test được skip theo môi trường, 0 fail; 11/11 type assertions.
- PostgreSQL thật: hai adapter độc lập cùng đặt phòng cuối, đúng một booking thành công và ledger không oversell.
- SQLite: concurrent checkout trong một process, đúng một booking thành công.
- Browser: đã kiểm tra Property detail, Room Type detail, Inventory và Reservation detail ở cả VI/EN; không có console error. Lượt kiểm tra trình duyệt phát hiện và đã sửa nhãn provider `website` bị rơi về key thô.

Benchmark ba database vật lý, mỗi database 72 phòng, 10 vòng đọc và 24 booking:

| Adapter | Catalog | Quote | Create online reservation | Isolation/contention |
| --- | ---: | ---: | ---: | --- |
| SQLite | 2,729 qps | 1,025 qps | 372 booking/s | đạt |
| PostgreSQL | 773 qps | 363 qps | 149 booking/s | đạt |

Các số trên dùng để bắt regression và kiểm chứng multi-database, không phải SLA production.

## Thay đổi và giới hạn cần biết

- Schema thay đổi theo hướng additive: `Reservation` có thêm `ratePlanId`, `requestKey`, `infants`, `roomQuantity`, `currency`; `Stay` có thêm `infants`, `roomQuantity`.
- `BOOKING_PROVIDERS` có thêm `website`.
- Không có public Website API/route trong phạm vi bàn giao này; team Website vẫn phải viết BFF transport, customer-session mapping và URL ảnh Storage.
- Chưa bao gồm payment capture/refund, kế toán/hóa đơn, promo code, dynamic pricing theo ngày, package hoặc tax breakdown.
- Cancellation dùng policy hiện tại của room type/property; chưa snapshot policy vào reservation.
- Currency lấy từ company, fallback `VND`; mọi số tiền trả dưới dạng decimal string.
