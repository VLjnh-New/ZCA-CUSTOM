# ZCA-CUSTOM

ZCA-CUSTOM là thư viện Node.js giúp tương tác với API Zalo, hỗ trợ đăng nhập, quản lý bạn bè, nhóm, tin nhắn, media, phản ứng, profile, nhãn, auto-reply, sticker, hội thoại, sự kiện và cuộc gọi thoại.

## Tính năng chính

- Đăng nhập bằng cookie/IMEI/userAgent hoặc QR code
- Hỗ trợ nhiều module API của Zalo
- Cấu hình đơn giản, dễ mở rộng
- Sử dụng chuẩn ES module (`type: module`)

## Cài đặt

```bash
npm install
```

## Sử dụng cơ bản

```js
import { Zalo } from "./index.js";

const zalo = new Zalo();

async function start() {
  const api = await zalo.login({
    imei: "your-imei",
    cookie: "your-cookie-string",
    userAgent: "your-user-agent",
  });

  console.log("Đã đăng nhập với UID:", api.getContext().uid);
}

start().catch(console.error);
```

## Đăng nhập QR

```js
import { Zalo } from "./index.js";

const zalo = new Zalo();

async function startQR() {
  const api = await zalo.loginQR({
    userAgent: "your-user-agent",
  }, (event) => {
    if (event.type === "GotLoginInfo") {
      console.log("Đã lấy thông tin đăng nhập QR", event.data);
    }
  });

  console.log("Đăng nhập QR thành công", api.getContext().uid);
}

startQR().catch(console.error);
```

## Cấu trúc thư mục

- `apis/`: các module API Zalo
- `models/`: định nghĩa loại dữ liệu và hằng số
- `Errors/`: các lớp lỗi riêng biệt
- `context.js`: quản lý ngữ cảnh ứng dụng
- `utils.js`: hàm tiện ích và hỗ trợ request
- `zalo.js`: lớp chính để đăng nhập và khởi tạo API

## Phiên bản

- `1.1.1`

## Repository

https://github.com/VLjnh-New/ZCA-CUSTOM.git

## Link cập nhật

https://github.com/VLjnh-New/ZCA-CUSTOM.git

## Ghi chú

Dự án chưa có package dependencies cụ thể trong `package.json`, vì vậy bạn có thể bổ sung thêm các thư viện cần thiết nếu dùng trong môi trường thực tế.
