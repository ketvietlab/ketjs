# Backend UI — bàn giao cho đội design

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

## Bàn giao lại

Xong phần CSS thì gửi lại nguyên hai file đó. Việc còn lại là của tôi:

- nối nút Cài/Gỡ vào server function (hiện là nút tĩnh)
- thêm island cho những chỗ cần tương tác thật
- form tạo/sửa trang
- trạng thái đang tải và xử lý lỗi trên giao diện

Thiếu trạng thái nào trong `/catalogue` thì nói, tôi thêm — tốt hơn là phát hiện lúc
đã ghép xong.
