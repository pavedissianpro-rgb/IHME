import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";

function jsonResponse(payload, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => "application/json" },
    json: async () => payload
  };
}

describe("formulaire de présence joueur", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      const address = String(url);
      if (address.endsWith("/api/sessions")) {
        return jsonResponse({ sessions: [{
          id: 12, session_date: "2026-10-30", start_time: "19:00:00", end_time: "21:00:00",
          location: "Gymnase Pillon", coach_name: "Camille Martin", present_count: 0,
          absent_count: 0, uncertain_count: 0
        }] });
      }
      if (address.endsWith("/api/trainers")) return jsonResponse({ trainers: [] });
      if (address.endsWith("/api/auth/me")) return jsonResponse({ error: "Connectez-vous." }, 401);
      if (address.endsWith("/api/sessions/12/responses")) {
        return jsonResponse({ responses: [], counts: { present: 0, absent: 0, incertain: 0 } });
      }
      if (address.endsWith("/api/responses") && options.method === "POST") {
        return jsonResponse({ response: { status: JSON.parse(options.body).status } });
      }
      throw new Error(`Unexpected request: ${address}`);
    }));
  });

  it("envoie les champs saisis et affiche la confirmation", async () => {
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Prénom"), { target: { value: "Élodie" } });
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Durand" } });
    fireEvent.change(screen.getAllByLabelText("Séance")[0], { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Présent" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer ma réponse" }));

    expect(await screen.findByText(/Votre réponse est enregistrée/u)).toBeInTheDocument();
    await waitFor(() => {
      const call = fetch.mock.calls.find(([url, options]) =>
        String(url).endsWith("/api/responses") && options?.method === "POST");
      expect(call).toBeDefined();
      expect(JSON.parse(call[1].body)).toEqual({
        firstName: "Élodie", lastName: "Durand", status: "present", sessionId: 12
      });
    });
  });
});
