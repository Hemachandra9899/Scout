"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/query/queryKeys";

export function useProjectConversations(projectId?: string) {
  return useQuery({
    queryKey: queryKeys.projectConversations(projectId || ""),
    queryFn: () => api.listProjectConversations(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useConversation(id?: string) {
  return useQuery({
    queryKey: queryKeys.conversation(id || ""),
    queryFn: () => api.getConversation(id!),
    enabled: Boolean(id),
  });
}

export function useCreateConversation(projectId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (title?: string) => {
      if (!projectId) {
        throw new Error("projectId is required");
      }

      return api.createConversation({ projectId, title });
    },
    onSuccess: () => {
      if (!projectId) return;

      queryClient.invalidateQueries({
        queryKey: queryKeys.projectConversations(projectId),
      });
    },
  });
}
