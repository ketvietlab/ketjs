---
title: Address benchmark evidence
description: Reproducible benchmark notes for the KetSuite Address module.
draft: true
---

# Address benchmark evidence

Đo ngày 2026-08-20 trên working tree `feat/address-vn`, ngay trước commit triển
khai. Benchmark gọi qua public/internal function boundary thật và PostgreSQL thật;
migration, tạo fixture và 20 lượt warm-up không nằm trong mẫu latency.

## Môi trường và cách đo

| Thành phần | Giá trị |
| --- | --- |
| PR base | `cede1d4` (`origin/develop` sau rebase; chỉ thêm tài liệu KetJS) |
| Runtime baseline | `875c5a5` (cùng runtime với `cede1d4`) |
| Node / npm | Node `v24.19.0`, npm `10.9.0` |
| OS / CPU | macOS `26.2`, Apple M1 Pro, arm64 |
| PostgreSQL | PostgreSQL `17.2`, `127.0.0.1:5435` |
| Database | `ket_address_bench_20260820`, chỉ dùng cho benchmark |
| Tải máy tại lần đo cuối | load average `88.53 / 78.67 / 74.15` |

```sh
KET_BENCH_PG=postgres://dev:devpassword@127.0.0.1:5435/ket_address_bench_20260820 \
  npm run bench:address
KET_BENCH_PG=postgres://dev:devpassword@127.0.0.1:5435/ket_address_bench_20260820 \
  npm run bench:identity
```

`bench:address` tạo schema mới, cài catalog VN gồm 3.355 Division, seed một
Partner/address, warm-up 20 lần rồi đo tuần tự 200 lượt cho mỗi hierarchy read và
300 lượt cho format/Partner detail. `bench:identity` tạo lại schema và 500 Partner,
warm-up 20 lần rồi đo 100 list cùng 300 lượt cho mỗi detail/mutation. Throughput là
số lời gọi tuần tự chia cho tổng thời gian đo, không phải tải đồng thời.

## Kết quả Address

| Workload | p50 (ms) | p95 (ms) | Throughput (ops/s) |
| --- | ---: | ---: | ---: |
| Cài catalog VN / 3.355 Division | 8.123,352 setup | — | — |
| List 34 tỉnh/thành cấp một | 3,633 | 6,720 | 253 |
| List đơn vị cấp dưới Hà Nội | 2,394 | 6,225 | 339 |
| Validate và format địa chỉ chuẩn | 3,458 | 5,814 | 267 |
| Đọc Partner cùng địa chỉ chuẩn | 6,236 | 13,111 | 138 |

Thời gian cài catalog là chi phí quản trị một lần và cố ý không trộn vào request
đọc thường xuyên. Dữ liệu không được load lúc server khởi động.

## Kiểm tra hồi quy Partner/identity

Base và head dùng cùng máy, PostgreSQL và fixture. Base được đo trước khi sửa code;
head được đo ngay sau `bench:address`.

| Workload | Base p50 / p95 (ms) | Head p50 / p95 (ms) | Base → head throughput |
| --- | --- | --- | ---: |
| List trang đầu / 500 Partner | 3,144 / 10,443 | 1,210 / 3,020 | 245 → 712 |
| Đọc Partner detail | 5,321 / 26,207 | 2,117 / 4,528 | 121 → 413 |
| Grant role idempotent | 3,688 / 15,626 | 2,197 / 4,803 | 191 → 384 |
| Đổi địa chỉ mặc định | 5,518 / 22,577 | 3,881 / 10,039 | 119 → 213 |

Không workload hiện hữu nào vượt ngưỡng tăng 15% p95 hoặc giảm 10% throughput.
Mọi p50, p95 và throughput head đều tốt hơn base. Máy đang có tải tương tác cao
nên kết quả này chỉ chứng minh không thấy hồi quy theo ngưỡng trong lần đo, không
được quy thành mức cải thiện do module Address.

## Kiểm chứng đi kèm

- 90 targeted tests pass: unit, PostgreSQL concurrency, HTTP E2E, Partner,
  Company/Branch, Hospitality và joint contract.
- Type check và format check pass; lint phần Address/Partner/Hospitality pass.
- Full suite không chạy local theo `AGENT.md`; CI chạy khi PR target `develop`.
- Browser acceptance covers desktop/mobile layouts in Vietnamese and English.
