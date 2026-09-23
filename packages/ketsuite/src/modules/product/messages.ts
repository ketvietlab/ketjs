import type { Message } from '@ketvietlab/ketjs'

export const messages: Record<string, Record<string, Message>> = {
  vi: {
    'error.attribute.required': 'Vui lòng nhập tên.',
    'error.attribute.displayType': 'Kiểu hiển thị không được hỗ trợ.',
    'error.attribute.createVariant': 'Chọn tạo biến thể luôn hoặc không tạo biến thể.',
    'error.attribute.values': 'Danh sách giá trị không hợp lệ.',
    'error.attribute.valueId': 'ID giá trị không hợp lệ.',
    'error.attribute.duplicateId': 'ID giá trị bị lặp.',
    'error.attribute.duplicateValue': 'Tên giá trị bị trùng trong thuộc tính.',
    'error.attribute.duplicateName': 'Đã có thuộc tính mang tên này.',
    'error.attribute.color': 'Màu phải có định dạng #RRGGBB.',
    'error.attribute.foreignValue': 'Giá trị không thuộc thuộc tính này.',
    'error.attribute.policyInUse':
      'Không thể đổi cách tạo biến thể khi thuộc tính đang được sản phẩm sử dụng.',
    'error.attribute.valueInUse': 'Không thể xoá giá trị đang được sản phẩm sử dụng.',

    'app.title': 'Sản phẩm',
    'app.summary': 'Danh mục, mẫu sản phẩm và biến thể.',
    'app.category': 'Bán hàng',
    'type.goods': 'Hàng hoá',
    'type.service': 'Dịch vụ',
    'variant.count': { one: '{count} biến thể', other: '{count} biến thể' },
  },
  en: {
    'error.attribute.required': 'Enter a name.',
    'error.attribute.displayType': 'This display type is not supported.',
    'error.attribute.createVariant': 'Choose always or never create variants.',
    'error.attribute.values': 'The values list is invalid.',
    'error.attribute.valueId': 'The value ID is invalid.',
    'error.attribute.duplicateId': 'The value ID is repeated.',
    'error.attribute.duplicateValue': 'Value names must be unique within this attribute.',
    'error.attribute.duplicateName': 'An attribute with this name already exists.',
    'error.attribute.color': 'Use a color in #RRGGBB format.',
    'error.attribute.foreignValue': 'This value belongs to another attribute.',
    'error.attribute.policyInUse':
      'The variant creation policy cannot change while products use this attribute.',
    'error.attribute.valueInUse': 'A value used by a product cannot be removed.',

    'app.title': 'Products',
    'app.summary': 'Categories, product templates and variants.',
    'app.category': 'Sales',
    'type.goods': 'Goods',
    'type.service': 'Service',
    'variant.count': { one: '{count} variant', other: '{count} variants' },
  },
}
