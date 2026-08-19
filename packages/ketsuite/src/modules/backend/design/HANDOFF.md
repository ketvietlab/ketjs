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
