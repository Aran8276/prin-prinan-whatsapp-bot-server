import type {UserState} from "../types.ts";

export const userSessions: Record<string, UserState> = {};

export const getSession = (chatId: string) => userSessions[chatId];
export const setSession = (chatId: string, session: UserState) => {
  userSessions[chatId] = session;
};
export const deleteSession = (chatId: string) => {
  delete userSessions[chatId];
};
