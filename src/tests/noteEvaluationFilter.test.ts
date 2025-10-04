import { shouldSubmitNote, evaluateNote } from "../filters/noteEvaluationFilter";

// Mock the getOAuth1Headers function to avoid needing real credentials in tests
jest.mock("../api/getOAuthToken", () => ({
  getOAuth1Headers: jest.fn(() => ({
    Authorization: "OAuth oauth_consumer_key=\"test\", oauth_token=\"test\""
  }))
}));

// Mock axios
jest.mock("axios");
import axios from "axios";
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("Note Evaluation Filter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("shouldSubmitNote", () => {
    test("should return true for score above threshold", async () => {
      // Mock API response with good score
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          data: {
            claim_opinion_score: 2.5
          }
        }
      });

      const result = await shouldSubmitNote("1234567890", "This is a test note with sources: https://example.com");

      expect(result.shouldSubmit).toBe(true);
      expect(result.score).toBe(2.5);
      expect(result.error).toBeUndefined();
    });

    test("should return false for score below threshold", async () => {
      // Mock API response with poor score
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          data: {
            claim_opinion_score: -2.0
          }
        }
      });

      const result = await shouldSubmitNote("1234567890", "This is a test note with sources: https://example.com");

      expect(result.shouldSubmit).toBe(false);
      expect(result.score).toBe(-2.0);
      expect(result.error).toBeUndefined();
    });

    test("should return false when API call fails", async () => {
      // Mock API failure
      mockedAxios.post.mockRejectedValueOnce(new Error("Network error"));

      const result = await shouldSubmitNote("1234567890", "This is a test note with sources: https://example.com");

      expect(result.shouldSubmit).toBe(false);
      expect(result.score).toBeUndefined();
      expect(result.error).toBe("Network error");
    });

    test("should return false when API returns errors", async () => {
      // Mock API response with errors
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          errors: [{ message: "Invalid request" }]
        }
      });

      const result = await shouldSubmitNote("1234567890", "This is a test note with sources: https://example.com");

      expect(result.shouldSubmit).toBe(false);
      expect(result.score).toBeUndefined();
      expect(result.error).toBe("API returned errors");
    });

    test("should use custom threshold", async () => {
      // Mock API response with score of 0
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          data: {
            claim_opinion_score: 0
          }
        }
      });

      const result = await shouldSubmitNote("1234567890", "This is a test note", 1.0);

      expect(result.shouldSubmit).toBe(false);
      expect(result.score).toBe(0);
    });
  });

  describe("evaluateNote", () => {
    test("should call API with correct parameters", async () => {
      // Mock successful API response
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          data: {
            claim_opinion_score: 1.5
          }
        }
      });

      await evaluateNote("1234567890", "Test note content");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.x.com/2/evaluate_note",
        {
          post_id: "1234567890",
          note_text: "Test note content"
        },
        {
          headers: {
            Authorization: "OAuth oauth_consumer_key=\"test\", oauth_token=\"test\"",
            "Content-Type": "application/json"
          },
          timeout: 30000
        }
      );
    });
  });
});