// The sign-in screen's markup lives in the kit, like every other screen's.
//
// Re-exported here because `user` is the module that publishes it and the route
// beside this file renders it — moving the file would have moved the ownership too.
export { loginScreen } from '../../ui/auth.tsx'
