---
title: View system handoff to KetSuite
description: Internal handoff notes for framework view-system changes that affect KetSuite.
pagefind: false
---

# Hệ thống view → bàn giao cho team KetSuite

Trạng thái: phần framework đã sửa xong (PR "view system contracts"). Tài liệu này liệt kê
những gì cùng đợt review nhưng **nằm ngoài framework**, nên thuộc về KetSuite, kèm những
thay đổi hành vi của framework mà KetSuite cần biết.

Phạm vi review: `packages/ketjs-view`, `packages/ketjs/src/theme`, `packages/ketjs/src/server/respond.ts`,
`packages/ketsuite/src/ui`, `packages/ketsuite/src/modules/*_backend`.

## 1. Framework đã đổi những gì

Không có thay đổi phá vỡ nào trong KetSuite (`npm run verify` xanh), nhưng năm điểm dưới đây
đổi hành vi và đáng nhớ:

| Trước | Sau |
|---|---|
| Prop kiểu view chỉ bị kiểm `typeof === 'object'` | Được **chiếu** xuống đúng field đã khai báo trước khi sang extension |
| `sealScope` chỉ từ chối hàm ở cấp một | Từ chối hàm ở mọi độ sâu, và báo đúng đường dẫn (`order.rows[0].act`) |
| Settings của section sang theme nguyên vẹn | Được chiếu về đúng schema `SectionDef.settings`; thiếu thì là `null` |
| `tokens` không ai đọc | Framework phục vụ `/_ket/tokens.css` và tự chèn `<link>` vào document của theme |
| Hai module trùng tên template → im lặng, module sau thắng | `E_TEMPLATE_DUPLICATE` (theme ghi đè module vẫn hợp lệ) |

Mã lỗi: joint không tồn tại **lúc render** nay là `E_UNKNOWN_JOINT` ở cả hai cửa
(storefront và màn hình first-party); `E_TEMPLATE_UNKNOWN_JOINT` chỉ còn dùng cho kiểm
template lúc build. `E_FILL_UNKNOWN_ISLAND` không còn ném lúc runtime — gỡ một app nay
không kéo sập theme của tenant nữa.

Quy tắc chiếu view, một câu: **một module đọc được field mà chủ view khai báo, cộng với
field chính nó khai báo trong một view trên cùng model.** Nhờ đó `inventory` vẫn đọc lại
`leadTimeDays` mà nó `extend` vào `catalog.Product`, còn field không ai khai báo thì không
sang được.

## 2. Việc của KetSuite — điều hướng và island

### 2.1 Tự kiểm header navigation (34 chỗ, 22 file)

`req.headers['x-ket-navigation'] === 'fragment-v1'` được viết tay ở 22 module backend.
Framework đã export sẵn `isNavigationRequest()`, `NAVIGATION_HEADER`, `NAVIGATION_VERSION`
— hiện chỉ [ui/layout.tsx](https://github.com/ketvietlab/ketjs/blob/develop/packages/ketsuite/src/ui/layout.tsx) dùng. Đổi version
protocol hôm nay là sửa 34 chỗ. Đây là việc cơ học, codemod được.

### 2.2 `stock_backend` dùng giao thức partial cũ

Ba bản `client/editor-view.mjs` (product, sale, stock) gần trùng nhau và đã trôi khỏi nhau:

- `product_backend` và `sale_backend`: envelope `ket-fragments` + `globalThis.__ketNavigation.applyFragments`.
- `stock_backend`: tự `querySelector('[data-ui="record-header"]')` rồi `replaceWith`
  ([editor-view.mjs:48](https://github.com/ketvietlab/ketjs/blob/develop/packages/ketsuite/src/modules/stock_backend/client/editor-view.mjs)).

Bản stock bỏ qua runtime navigation, không giữ state island, và bám vào `data-ui` — vốn là
hợp đồng của đội design, không phải điểm neo cho JS. Nên đưa stock về giao thức
`ket-fragments`, rồi gộp ba bản thành một helper trong `ui/client/`.

### 2.3 `x-ket-partial` là giao thức điều hướng thứ ba

Framework có `x-ket-navigation: fragment-v1`. Ba module tự thêm header riêng với chuỗi scope
riêng (`sale-order`, `stock-transfer`, `stock-lot`, `product-detail`). Nên xét gộp về
`navigablePage()` với slot đặt tên, thay vì một header mỗi màn hình.

## 3. Việc của KetSuite — kit UI

- **`framed` và `shell` đảo thứ tự tham số**: `shell(_, title, body, frame)` so với
  `framed(_, title, frame, body)`, cùng file [ui/layout.tsx](https://github.com/ketvietlab/ketjs/blob/develop/packages/ketsuite/src/ui/layout.tsx).
  Chỉ có TypeScript đỡ.
- **JSX bắt buộc nhưng chỉ là hình thức**: `ui-audit` ép `*screen*.tsx` viết `<Section/>`,
  nên 53 file lặp `framedPage as Framed`, 49 file lặp `recordForm as RecordForm`. Nội dung
  vẫn truyền qua prop `body=` chứ không phải `children`, dù JSX runtime hỗ trợ `children`.
  Ba lối ra: export sẵn alias PascalCase trong kit, hoặc chuyển `body` → `children`, hoặc bỏ
  luật. Giữ nguyên là trả phí mà không nhận gì.
- **Ba họ card song song**: `contentCard`/`cardGrid` (surfaces), `kanbanCard`/`kanbanGrid`
  (data), `appCard`/`card`/`cardGroups` (layout) — cấu trúc gần trùng, tên slot khác nhau
  (`summary` vs `note`). Thêm `nav.tsx` (sidebar) và `navigation.tsx` (breadcrumb/tab) là hai
  tên gần đồng nghĩa.
- **List không đồng đều**: 19 module render `dataTable`, chỉ 4 (`backend`, `crm_backend`,
  `partner_backend`, `product_backend`) có list state/paging/chrome theo D43–D44.
  `loyalty_backend` gọi `limit: 1000` rồi đổ hết ra màn hình, không search không pager.

## 4. Việc của KetSuite — cấu trúc module

- `hospitality_core/screens.tsx` **6.754 dòng** trong một file, và đặt screens/routes ngay
  trong module domain trong khi mọi thứ khác tách `*_backend`.
- `stock_backend`/`account_backend` tách mỗi màn một file, phần lớn còn lại gom vào
  `screens.tsx`. Bốn module (`account_backend`, `pos_backend`, `pricing_backend`,
  `purchase_backend`) để routes trong `index.ts` thay vì `routes.ts`.
- `theme_default` vẫn được export cạnh ba theme thật dù nó thuộc bộ demo `catalog` và không
  cung cấp template `website.*` nào — chọn nó là `E_REGION_NOT_RENDERABLE` lúc runtime.

## 5. Token — việc mở ra sau khi framework đã nối dây

Giờ `/_ket/tokens.css` đã tự lên mọi trang storefront, ba việc trở nên khả thi:

1. **`theme_retail` và `theme_hospitality` hardcode `<link rel="stylesheet" href="/_ket/asset/theme_*/theme.css">`
   trong `layout.ktl`** dù đã khai `styles: ['theme.css']`. Chuỗi đó gắn cứng tên module và
   sơ đồ URL asset của framework vào markup của theme. Đồng thời bảng màu nằm trong
   `theme.css` chứ không phải trong `tokens`, nên đổi màu là sửa CSS chứ không phải sửa token.
2. **`theme_paper` không có stylesheet nào** nhưng markup vẫn mang `class="hero"`,
   `class="prose"`… Nay ít nhất token của nó đã lên trang; phần còn lại cần một `theme.css`
   viết theo `--ket-*`.
3. **Backend dùng `--admin-*`, framework phát `--ket-*`**. Hai từ vựng token cho một sản
   phẩm. Nếu muốn hợp nhất thì `design/tokens.css` nên nhận `--ket-*` làm nguồn và `--admin-*`
   là lớp vai trò dẫn xuất — nhưng đây là quyết định của đội design, không phải của framework.

**Chưa làm, và cố ý:** `website.Site.tokens` (`json?`, [models.ts:18](https://github.com/ketvietlab/ketjs/blob/develop/packages/ketsuite/src/modules/website/models.ts))
cho phép mỗi site đè token, và hiện chưa ai đọc. Muốn nối thì phải làm cứng `tokensToCss()`
trước: hiện nó chỉ lọc ký tự của **tên** token, không lọc **giá trị**, nên dữ liệu từ database
có thể thoát khỏi khối CSS. Đó là lý do đợt này chỉ nối nguồn token đáng tin (khai báo trong
code module/theme).

## 6. Những chỗ đang rất nhất quán — đừng đụng vào

- Tách `html`/JSX cho first-party và KTL cho theme (D3/D18/D29): có lý lẽ, và được thi hành
  thật bằng `defineTheme()` từ chối `models`/`functions`/`routes`.
- Hợp đồng `data-ui`: HOOKS khai báo cạnh markup, gộp ở `ui/hooks.ts`, khoá bằng
  `backend-ui.test.ts` (kể cả "mọi hook phải có rule CSS", "markup không mang class"), cộng
  `ui-audit` chặn markup lọt ra ngoài kit. Đây là phần kỷ luật nhất của repo.
- Renderer: một `Host` trừu tượng cho DOM / string / counting mock; hydration adopt chứ không
  dựng lại; mismatch ném lỗi kèm hint.
