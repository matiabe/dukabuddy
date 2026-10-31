import { createContext, useContext } from 'react'

// { user, shopName, isOwner, refresh(), logout() } - provided by App once someone is logged in
export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)
