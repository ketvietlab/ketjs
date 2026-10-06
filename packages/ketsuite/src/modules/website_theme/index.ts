import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions/index.ts'
import { models } from './models.ts'
import { routes } from './routes.ts'

const vi = {
  'app.title': 'Website · Giao diện',
  'app.summary': 'Kho giao diện riêng của công ty cho website, có CSS và JavaScript chạy ở trình duyệt.',
  'app.category': 'Website',
  'error.companyRequired': 'Cần chọn công ty sở hữu giao diện.',
  'error.invalidPackage': 'Gói giao diện không hợp lệ.',
  'error.versionConflict': 'Phiên bản này đã được cài với nội dung khác. Hãy tăng số phiên bản.',
  'error.versionNotFound': 'Không tìm thấy phiên bản giao diện.',
  'error.revoked': 'Phiên bản giao diện đã bị thu hồi.',
  'error.invalidTransition': 'Không thể chuyển phiên bản giao diện sang trạng thái này.',
  'error.editConflict': 'Phiên bản giao diện vừa được thay đổi. Hãy thử lại.',
  'error.unavailable': 'Giao diện này không dùng được cho website của công ty.',
  'error.invalidSetting': 'Tùy chọn giao diện không hợp lệ.',
  'error.manifestInvalid': 'theme.json không hợp lệ.',
  'error.manifestUnknownKey': 'theme.json có trường không được hỗ trợ.',
  'error.manifestEngine': 'theme.json phải khai engine website-theme/1.',
  'error.manifestKey': 'Mã giao diện không hợp lệ.',
  'error.manifestVersion': 'Số phiên bản không hợp lệ.',
  'error.manifestTier': 'Chỉ cài được giao diện riêng (private).',
  'error.manifestTitle': 'Tên giao diện không hợp lệ.',
  'error.manifestSettings': 'Khai báo tùy chọn giao diện không hợp lệ.',
  'error.manifestSections': 'Danh sách section không hợp lệ.',
  'error.manifestFonts': 'Danh sách font không hợp lệ.',
  'error.manifestScript': 'Khai báo script không hợp lệ.',
  'error.manifestOrigin': 'Origin cho script phải là https và tối đa 10 mục.',
  'error.manifestFrame': 'Danh sách vị trí khung không hợp lệ.',
  'error.frameMissing': 'Thiếu tệp KTL cho vị trí đã khai báo.',
  'error.frameUndeclared': 'Tệp KTL chưa được khai báo trong manifest.',
  'error.frameInvalid': 'Tệp KTL không hợp lệ hoặc có HTML không an toàn.',
}
const en = {
  'app.title': 'Website · Themes',
  'app.summary': "A company's own website themes, with CSS and browser JavaScript.",
  'app.category': 'Website',
  'error.companyRequired': 'Choose the company that owns the theme.',
  'error.invalidPackage': 'The theme package is not valid.',
  'error.versionConflict': 'This version was installed with other content. Raise the version number.',
  'error.versionNotFound': 'Theme version not found.',
  'error.revoked': 'The theme version has been revoked.',
  'error.invalidTransition': 'The theme version cannot move to this status.',
  'error.editConflict': 'The theme version just changed. Try again.',
  'error.unavailable': "This theme is not available to the company's sites.",
  'error.invalidSetting': 'A theme setting is not valid.',
  'error.manifestInvalid': 'theme.json is not valid.',
  'error.manifestUnknownKey': 'theme.json has an unsupported field.',
  'error.manifestEngine': 'theme.json must declare engine website-theme/1.',
  'error.manifestKey': 'The theme key is not valid.',
  'error.manifestVersion': 'The version number is not valid.',
  'error.manifestTier': 'Only private themes can be installed.',
  'error.manifestTitle': 'The theme title is not valid.',
  'error.manifestSettings': 'The theme settings declaration is not valid.',
  'error.manifestSections': 'The section list is not valid.',
  'error.manifestFonts': 'The font list is not valid.',
  'error.manifestScript': 'The script declaration is not valid.',
  'error.manifestOrigin': 'Script origins must be https, at most 10.',
  'error.manifestFrame': 'The frame slot list is not valid.',
  'error.frameMissing': 'A declared frame slot has no KTL file.',
  'error.frameUndeclared': 'A KTL file is not declared in the manifest.',
  'error.frameInvalid': 'A KTL file is invalid or contains unsafe HTML.',
}

export default defineModule({
  name: 'website_theme',
  version: '0.1.0',
  title: 'Website themes',
  summary: "A company's own website themes, with CSS and browser JavaScript.",
  category: 'Website',
  depends: ['website'],
  messages: { vi, en },
  models,
  functions,
  routes,
})

export { installThemePackage, installWebsiteTheme, readThemeDirectory } from './install.ts'
export type { ThemeInstallResult, ThemeInstallTarget } from './install.ts'
export { checkThemeCss, checkThemePackage, resolveThemeSettings } from './package.ts'
export type { SelectedTheme, ThemeManifest } from './types.ts'
