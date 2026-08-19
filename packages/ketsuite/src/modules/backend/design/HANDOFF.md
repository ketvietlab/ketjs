# Backend UI — bàn giao cho đội design

## Trạng thái triển khai — 2026-08-19

Visual baseline đã hoàn tất trong `design/tokens.css` và `design/admin.css` theo hướng
**enterprise dense**: nhiều dữ liệu hữu ích trên một viewport, hierarchy tạo bằng
divider và typography thay vì khoảng trắng/card/shadow quá mức.

Các thông số đã chốt:

| Vai trò | Giá trị |
|---|---:|
| Sidebar desktop | `228px` |
| Topbar desktop | `52px` |
| Data row | `44px` |
| Control compact desktop | `32px` |
| Touch target mobile | `44px` |
| Body / compact UI | `14px` / `13px` |
| Breakpoint mobile shell | `< 768px` |

Ngôn ngữ thị giác kế thừa KétViệt Design System: warm-neutral canvas, white/dark
surface, border mảnh và indigo chỉ dành cho primary action, focus và selection.
Primary action dùng `brand-600`; active navigation dùng label `brand-700` trên nền
sáng, đóng hai migration gap còn tồn tại trong theme Odoo.

## Chạy lên trong 30 giây

```bash
npm run design
```

| | |
|---|---|
| `http://127.0.0.1:4000/catalogue` | **mọi màn hình, mọi trạng thái** — đây là chỗ làm việc chính |
| `http://127.0.0.1:4000/admin/apps` | màn hình thật, dữ liệu thật |
| `http://127.0.0.1:4000/admin/pages` | |
| `http://127.0.0.1:4000/admin/settings` | |

Database nằm trong bộ nhớ và được tạo lại mỗi lần khởi động. Cài app, gỡ app, làm hỏng
thoải mái — khởi động lại là sạch. Không có gì ở đây chạm vào hệ thống thật.

## Ai sở hữu cái gì

| | |
|---|---|
| **của đội design** | `design/tokens.css` · `design/admin.css` |
| **của framework** | mọi file `.ts` |

Sửa CSS xong bấm F5 là thấy, không cần build, không cần khởi động lại.

## Hợp đồng: thuộc tính `data-ui`

CSS viết theo `[data-ui="..."]`, **không phải class**. Cố ý: một cái class là một quyết
định về việc thứ đó trông thế nào, mà quyết định đó là của đội design chứ không phải
của tôi. Nên markup không mang sẵn class nào.

Toàn bộ selector được liệt kê trong `admin.css`, kèm các trạng thái mỗi cái có thể ở.
Chúng **được khoá bằng test** (`test/backend-ui.test.ts`): nếu tôi lỡ đổi hoặc xoá một
`data-ui`, test đỏ. Nghĩa là CSS của các bạn không thể vỡ ngầm.

Đổi được, nhưng theo đường: nói ra → sửa markup + test cùng lúc → ghi vào file này.

## Ba thứ xin lưu ý

**1. Thiết kế đủ mọi trạng thái, không chỉ trạng thái đẹp.** `/catalogue` cố tình có
danh sách rỗng, danh sách 40 dòng, tên tràn dòng, và nút bị vô hiệu. Thiết kế nào chỉ
phủ đường hạnh phúc là thiết kế sẽ phải làm lại lần hai.

**2. Lỗi luôn có ba phần.** Mọi lỗi của framework đều mang mã máy đọc được, một câu mô
tả, và một gợi ý sửa:

```
E_APP_IN_USE
"website" không gỡ được khi website_menu đang cài.
Gỡ website_menu trước, hoặc để website ở nguyên.
```

Cả ba đều cần chỗ hiển thị. Phần gợi ý là thứ khiến người dùng tự thoát ra được, đừng
cắt nó đi.

**3. Token trước, quy tắc sau.** Điền `tokens.css` trước rồi hãy viết `admin.css` tham
chiếu tới chúng. Thứ tự tầng đã cố định:

```
ket.reset  <  ket.theme  <  ket.app  <  ket.user
```

Các bạn viết trong `ket.app`, nên luôn thắng theme mà không cần đấu specificity. Chế độ
tối chỉ cần đổi token, không cần viết lại quy tắc.

## Đa ngôn ngữ — thêm sau bản thiết kế đầu

Mọi chuỗi giờ đã nằm trong catalog. Đổi ngôn ngữ bằng `?lang=` trên bất kỳ màn hình nào:

| | |
|---|---|
| `?lang=vi` | tiếng Việt (mặc định) |
| `?lang=en` | tiếng Anh — bản dịch thật, không phải chữ giả |
| `?lang=qps` | **pseudo-locale**: mọi chuỗi dài hơn và có ngoặc vuông |

`qps` là thứ đáng dùng nhất. Nó trả về `⟦Quuản trị⟧` thay vì `Quản trị` — dài hơn và
có ranh giới nhìn thấy được. Layout nào chỉnh vừa khít tiếng Việt sẽ **lộ chỗ vỡ ngay**,
trước khi có bản dịch tiếng Đức hay tiếng Anh thật. Xin kiểm mọi màn hình ở `?lang=qps`
trước khi coi là xong.

Chuỗi tiếng Anh trong catalog là bản dịch thật chứ không phải placeholder — một locale
thứ hai mà giả thì không chứng minh được gì về việc layout có sống nổi với nó không.

## Ranh giới: đây **không** phải theme storefront

Theme storefront là code của người lạ, nên viết bằng ngôn ngữ hạn chế không chạy được
gì. Backend là của mình, nên viết bằng `html` đầy đủ. Hai thứ khác nhau và không dùng
chung cơ chế — chi tiết trong `docs/00-decisions.md` (D3, D18).

Hệ quả với các bạn: ở đây các bạn có toàn quyền về CSS, nhưng markup thì đề xuất chứ
không tự sửa, vì nó gắn với dữ liệu thật.

## Quyết định List View — zero dependencies

List View không dùng TanStack Table, AG Grid hoặc CSS framework. Nền tảng là semantic
HTML (`table`, `thead`, `tbody`, `th`) + CSS thuần; hành vi tương tác sau này là island
nhỏ dùng signal/DOM API đã có trong `ketjs-view`.

Quy ước triển khai tiếp theo:

- column schema typed khai báo label, kiểu dữ liệu, alignment, width, priority và khả
  năng sort;
- sort, filter và cursor pagination chạy phía server; URL giữ query state để reload,
  back và deep link đúng;
- selection và bulk action hydrate riêng, không hydrate toàn bảng;
- mặc định lấy `50–100` dòng mỗi trang, không render hàng nghìn dòng;
- chỉ làm virtual scrolling khi benchmark thực tế chứng minh pagination không đủ;
- mobile giữ `3–5` field cần ra quyết định, không tự biến mọi row thành card;
- table hiện tại giữ đủ ba cột trên `360px`, không gây document-level overflow.

CSS hiện tại chỉ triển khai presentation contract đang có. Column schema, sorting,
filtering, pagination và selection cần một thay đổi framework riêng thay vì được giả
lập bằng CSS.

## Bàn giao cho framework

Phần CSS trong contract hiện tại đã hoàn tất. Các việc còn lại thuộc markup/behavior:

- nối nút Cài/Gỡ vào server function;
- thêm island cho List View và những chỗ cần tương tác thật;
- thêm status label semantic riêng cho app đã cài/chưa cài;
- liên kết lý do nút disabled bằng `aria-describedby`;
- thay mobile navigation tạm thời bằng trigger + drawer khi số menu tăng;
- thêm toggle `data-theme="light|dark"`; system preference hiện là fallback;
- form tạo/sửa trang;
- trạng thái loading và xử lý lỗi trên giao diện.

Visual QA đã kiểm tra tại `360px`, `768px`, `1024px`, `1440px`, bao gồm danh sách
40 dòng, chuỗi tiếng Việt dài, disabled action, empty/error state và dark system
preference. Quality gate chuẩn là `npm run verify` với Node `>=24`.

Ảnh QA dùng trong PR được lưu tại `design/screenshots/`. Chúng là bằng chứng kiểm tra
ở thời điểm bàn giao, không thay thế token, CSS hoặc `data-ui` contract làm đặc tả.


## Màn hình đăng nhập và thanh danh tính (mới)

Hai bề mặt vừa thêm, chưa có CSS. Markup đã xong, phần nhìn là của đội design.

**Màn đăng nhập** — `/login`, do module `user` dựng:

| Selector | Là gì |
|---|---|
| `[data-ui="login"]` | khung ngoài, chiếm cả trang |
| `[data-ui="login-form"]` | form, `method="post"` |
| `[data-ui="login-title"]` | tiêu đề |
| `[data-ui="login-error"]` | thông báo sai mật khẩu, `role="alert"`, chỉ hiện khi có lỗi |
| `[data-ui="field"]`, `[data-ui="field-label"]`, `[data-ui="field-input"]` | một ô nhập; dùng lại được ở form khác |
| `[data-ui="login-submit"]` | nút gửi |
| `[data-ui="login-locales"]`, `[data-ui="login-locale"][data-active]` | đổi ngôn ngữ, chỉ hiện khi có nhiều hơn một |

Trang này **chạy không cần JavaScript** và phải giữ như vậy: một trang đăng nhập
hỏng khi script lỗi là trang hỏng đúng lúc người ta cần vào nhất.

**Thanh danh tính** — nằm trong `[data-ui="topbar"]` đã có, bên cạnh
`[data-ui="title"]`:

| Selector | Là gì |
|---|---|
| `[data-ui="viewer"]` | cụm bên phải thanh trên |
| `[data-ui="viewer-name"]` | tên người đang đăng nhập |
| `[data-ui="viewer-company"]` | công ty đang chọn — **chỉ hiện khi tài khoản thuộc nhiều hơn một công ty** |
| `[data-ui="signout"]` | form POST tới `/logout` |
| `[data-ui="signout-button"]` | nút bên trong nó |

Sáu trạng thái đã có sẵn trong `/catalogue` (`npm run design`):

    login            đăng nhập, trống
    login-failed     sai mật khẩu — thông báo có role="alert"
    login-next       có ô ẩn "next", quay lại nơi đang tới
    viewer-one       thanh trên, tài khoản một công ty
    viewer-many      thanh trên, nhiều công ty — có tên công ty đang chọn
    viewer-long      tên người và tên công ty đều dài, kiểm tra thanh trên không vỡ

Hiện **chưa có quy tắc CSS nào** cho các selector này: trang đăng nhập nhúng
`tokens.css` và `admin.css` như mọi màn hình khác, nhưng hai file đó chưa nói gì
về `[data-ui="login"]`. Đó là phần việc tiếp theo của đội design.

Một chỗ chưa có điều khiển: tài khoản thuộc nhiều công ty thì `viewer-company` chỉ
**hiện** công ty đang chọn, chưa **đổi** được. Khi vẽ tới đó, cần một control ở chính
chỗ này.

## Điều hướng hai cấp

Sidebar giờ có hai tầng: danh sách ứng dụng, rồi menu bên trong ứng dụng đang mở.
Cây menu do module khai báo (xem D42) và **đã được lọc trước khi tới CSS** — cái gì
chưa cài, hoặc người đang đăng nhập không có quyền gọi, thì không có trong HTML.
Không cần CSS ẩn gì cả.

| hook | ý nghĩa |
| --- | --- |
| `[data-ui="app-switch"]`, `[data-ui="app-current"]` | tên ứng dụng đang mở, trên cùng |
| `[data-ui="app-list"]`, `[data-ui="app-list-title"]` | danh sách ứng dụng và nhãn của nó |
| `[data-ui="app-entry"][data-active]` | một ứng dụng; `true` là cái đang mở |
| `[data-ui="app-icon"]`, `[data-ui="app-name"]` | dấu hiệu và tên bên trong `app-entry` |
| `[data-ui="menu"]`, `[data-ui="menu-app"]` | menu của ứng dụng đang mở, và tên nó |
| `[data-ui="menu-item"][data-active]` | một mục dẫn tới trang; `true` là trang đang xem |
| `[data-ui="menu-section"][open]` | một nhóm — là `<details>`, gập được không cần JavaScript |
| `[data-ui="menu-section-title"]` | `<summary>` của nhóm đó |

`[data-ui="nav-item"]` vẫn còn, nhưng chỉ dành cho module khác chèn thêm qua joint
`backend:nav.items`. Màn hình không tự sinh ra nó nữa.

## Khung danh sách

Hàng điều khiển phía trên một danh sách. **Mọi thứ trong đây là link hoặc form
`method="get"`** — không có `<button>`, và có test giữ điều đó. Nghĩa là nút back,
bookmark và link dán vào chat đều chạy mà không ai phải viết code.

Điều khiển nào không có gì để nói thì **không được render**: hết trang thì không có
pager, chỉ một kiểu xem thì không có nút đổi kiểu. Đừng viết CSS để ẩn — nó không có
trong HTML.

| hook | ý nghĩa |
| --- | --- |
| `[data-ui="list-chrome"]` | cả hàng; `chrome-lead` bên trái, `chrome-tail` bên phải |
| `[data-ui="chrome-create"]` | nút chính (“Mới”) — hiện tại chưa màn hình nào bật |
| `[data-ui="crumbs"]`, `[data-ui="crumb"]` | đường dẫn; mục cuối có `aria-current="page"` và **không** phải link |
| `[data-ui="chrome-search"]` | form tìm kiếm; style trạng thái gõ bằng `:focus-within` |
| `[data-ui="chrome-search-input"]` | ô nhập bên trong nó |
| `[data-ui="facet"]`, `[data-ui="facet-label"]`, `[data-ui="facet-remove"]` | một bộ lọc đang bật, và dấu × để bỏ |
| `[data-ui="pager"]`, `[data-ui="pager-range"]` | “1-30 / 84” |
| `[data-ui="pager-step"][data-dir][aria-disabled]` | mũi tên; hết đường thì **vẫn nằm đó**, chỉ mờ đi — nếu biến mất thì thanh công cụ đổi chiều rộng |
| `[data-ui="view-switch"]`, `[data-ui="view-kind"][data-active]` | đổi kiểu xem |
| `[data-ui="kanban"]`, `[data-ui="kanban-card"]`, `[data-ui="kanban-title"]`, `[data-ui="kanban-meta"]`, `[data-ui="kanban-uom"]`, `[data-ui="kanban-variants"]` | kiểu xem thẻ |
| `[data-ui="table"] [data-align="end"]` | cột số — canh phải, `tabular-nums` |

## Bảng dữ liệu

Cột là **dữ liệu** do module khai báo, không phải markup. Nên mọi danh sách trong sản
phẩm có cùng chiều cao dòng, cùng header dính, cùng cách tràn ngang.

Cột tuỳ chọn khi tắt thì **không có trong HTML** — đừng viết CSS để ẩn. Menu chọn cột
là danh sách link (checkbox sẽ cần handler, mà handler là state phía client).

Danh sách **chạy hết chiều ngang của khung**: không viền hai bên, không bo góc, không
đổ bóng. Màn hình để *đọc* (lưới ứng dụng, danh sách token) thì vẫn giữ bề rộng đọc —
chọn bằng `:has()`, không phải bằng class.

| hook | ý nghĩa |
| --- | --- |
| `[data-ui="table-scroll"]` | hộp cuộn ngang; trang **không** được cuộn ngang theo |
| `[data-ui="table"]`, `[data-ui="col"][data-align]` | bảng và ô tiêu đề cột |
| `[data-ui="row"][data-row]`, `[data-ui="cell"][data-col][data-align]` | dòng và ô; `data-col` là khoá cột |
| `[data-ui="col-actions"]`, `[data-ui="cell-actions"]` | cột cuối chứa nút chọn cột |
| `[data-ui="col-config"]`, `[data-ui="col-config-open"]`, `[data-ui="col-config-menu"]` | `<details>` chọn cột |
| `[data-ui="col-toggle"][data-on]`, `[data-ui="col-toggle-mark"]` | một cột trong menu đó |
| `[data-ui="badge"][data-tone][data-value]` | trạng thái; tone là `neutral` `info` `positive` `warning` `danger` |
| `[data-ui="person"]`, `[data-ui="person-name"]`, `[data-ui="avatar"]` | tên người kèm chữ đầu |

**Đổi hợp đồng:** `[data-ui="badge"][data-published]` đã bỏ, thay bằng `[data-tone]`.
`[data-ui="cell-path"]`, `[data-ui="cell-title"]`, `[data-ui="cell-state"]` cũng bỏ —
giờ là `[data-ui="cell"][data-col="path"]` và tương tự.

Thanh công cụ **chỉ có một**: tiêu đề bên trái, ô tìm ở giữa, pager và nút đổi kiểu
xem ở cuối. **Không có breadcrumb** — sidebar đã nói đang ở ứng dụng nào, mục nào.

Người đang đăng nhập nằm ở **đáy sidebar**, cùng hàng đếm việc/thông báo
(`[data-ui="sidebar-foot"]`, `[data-ui="indicators"]`, `[data-ui="indicator"][data-kind]`,
`[data-ui="indicator-count"]`). Số 0 thì **không** render con số, chỉ còn icon.

## Sidebar — port từ vidoo_backend_theme

Sidebar ở đây **là** sidebar của `vidoo_backend_theme` trong repo kingfruit: 228px,
không có thanh ứng dụng ngang trên desktop, systray nằm ở chân. Cùng số đo, cùng
bảng màu `--kv-*` (token của admin vốn đã lấy từ đó). Sửa bên nào thì phải nói bên
kia — mục tiêu là hai sản phẩm trông như một.

Icon: 12 glyph Lucide (ISC) **chép vào** `icons.ts`, không cài package — giống hệt
cách theme Odoo làm. `MenuDef.icon` là *tên* icon; tên nào không có thì rơi về
monogram (chữ đầu), không mất dòng.

`[data-ui="icon"]` mặc định `1em`. Hộp nào cỡ cố định thì tự khai báo cho `<svg>`
bên trong đầy hộp — đừng đặt `width:100%` ở mức chung.

| hook | ý nghĩa |
| --- | --- |
| `[data-ui="sidebar-header"]`, `[data-ui="sidebar-brand"]` | hàng thương hiệu / tên app đang mở |
| `[data-ui="sidebar-search"]`, `[data-ui="sidebar-search-input"]` | **tìm menu** (khác ô tìm bản ghi ở control panel) |
| `[data-ui="sidebar-nav"]` | vùng cuộn; brand, search và chân đứng yên |
| `[data-ui="sidebar-section-label"][data-scope="app"]` | nhãn nhóm; `data-scope="app"` là nhãn của app đang mở |
| `[data-ui="sidebar-empty"]` | không tìm thấy gì |
| `[data-ui="app-entry"][data-active]`, `[data-ui="app-icon"]`, `[data-ui="app-monogram"]` | một app |
| `[data-ui="menu-item-wrap"][data-depth]` | một mục, kèm độ sâu |
| `[data-ui="menu-section-chevron"]`, `[data-ui="menu-section-text"]`, `[data-ui="menu-section-children"]` | nhóm; con có đường kẻ dọc bên trái |
| `[data-ui="menu-item"][data-active]`, `[data-ui="menu-dot"]`, `[data-ui="menu-label"]` | một mục lá |
