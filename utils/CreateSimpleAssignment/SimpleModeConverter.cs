using System;
using System.Collections.Generic;
using System.Text;

namespace CreateSimpleAssignment
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Text.Json;
    using System.Text.Json.Serialization;

    public static class SimpleModeConverter
    {
        // ---------- INPUT (simple mode) ----------
        public sealed class SimpleItem
        {
            [JsonPropertyName("qType")]
            public string QType { get; set; } = "";

            [JsonPropertyName("passageId")]
            [JsonIgnore(Condition = JsonIgnoreCondition.Never)]
            public string? PassageId { get; set; } // null or "P#"

            [JsonPropertyName("image")]
            public string? Image { get; set; } // "1.png" / "p1.png" etc.

            [JsonPropertyName("qOptions")]
            public List<string>? QOptions { get; set; } // [] or 4 options for match-list

            // Can be "A", ["A","C"], 12.5, or [] (passage)
            [JsonPropertyName("qAnswer")]
            public JsonElement QAnswer { get; set; }
        }

        // ---------- OUTPUT (old/full mode) ----------
        public sealed class OldItem
        {
            [JsonPropertyName("qType")]
            public string QType { get; set; } = "";

            [JsonPropertyName("passageId")]
            [JsonIgnore(Condition = JsonIgnoreCondition.Never)]
            public string? PassageId { get; set; }

            [JsonPropertyName("qText")]
            public string QText { get; set; } = "";      // always empty in conversion

            [JsonPropertyName("image")]
            public string? Image { get; set; }

            [JsonPropertyName("qOptions")]
            public List<string> QOptions { get; set; } = new();

            // string | string[] | number | []
            [JsonPropertyName("qAnswer")]
            public object QAnswer { get; set; } = new List<object>();

            // Optional fields in old spec (we omit them by default)
            // public string sText { get; set; }
            // public string sImage { get; set; }
        }

        /// <summary>
        /// Converts "simple mode" JSON array into "old" JSON array.
        /// - Adds qText="" for every item.
        /// - Preserves qType, passageId, image, qOptions, qAnswer.
        /// - Omits sText/sImage.
        /// </summary>
        public static string ConvertSimpleJsonToOldJson(string simpleJson, bool indented = true)
        {
            var readOpts = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            };

            var simpleItems = JsonSerializer.Deserialize<List<SimpleItem>>(simpleJson, readOpts)
                             ?? new List<SimpleItem>();

            var oldItems = simpleItems.Select(ToOldItem).ToList();

            var writeOpts = new JsonSerializerOptions
            {
                WriteIndented = indented,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
            };

            return JsonSerializer.Serialize(oldItems, writeOpts);
        }

        private static OldItem ToOldItem(SimpleItem s)
        {
            var old = new OldItem
            {
                QType = s.QType ?? "",
                PassageId = s.PassageId,
                QText = "", // per your request: simple output has no qText; old requires it
                Image = s.Image,
                QOptions = (s.QOptions ?? new List<string>()).ToList(),
                QAnswer = ConvertAnswerElement(s.QAnswer)
            };

            // Safety: If it’s a Passage, enforce old-spec conventions.
            if (string.Equals(old.QType, "Passage", StringComparison.OrdinalIgnoreCase))
            {
                old.QOptions = new List<string>();
                old.QAnswer = new List<object>(); // []
            }

            return old;
        }

        private static object ConvertAnswerElement(JsonElement el)
        {
            // Handles: "A", ["A","C"], 12.5, [], null
            switch (el.ValueKind)
            {
                case JsonValueKind.String:
                    return el.GetString() ?? "";

                case JsonValueKind.Number:
                    // Prefer integer if it's exactly integral, else double.
                    if (el.TryGetInt64(out long l)) return l;
                    return el.GetDouble();

                case JsonValueKind.Array:
                    // Could be [] (passage) or ["A","C"]
                    var list = new List<object>();
                    foreach (var item in el.EnumerateArray())
                    {
                        switch (item.ValueKind)
                        {
                            case JsonValueKind.String:
                                list.Add(item.GetString() ?? "");
                                break;
                            case JsonValueKind.Number:
                                if (item.TryGetInt64(out long li)) list.Add(li);
                                else list.Add(item.GetDouble());
                                break;
                            case JsonValueKind.True:
                            case JsonValueKind.False:
                                list.Add(item.GetBoolean());
                                break;
                            case JsonValueKind.Null:
                            case JsonValueKind.Undefined:
                                list.Add(null!);
                                break;
                            default:
                                // Fallback: store raw JSON text for unexpected structures
                                list.Add(item.GetRawText());
                                break;
                        }
                    }
                    return list;

                case JsonValueKind.True:
                case JsonValueKind.False:
                    return el.GetBoolean();

                case JsonValueKind.Null:
                case JsonValueKind.Undefined:
                    // Old spec doesn't really expect null qAnswer; map to []
                    return new List<object>();

                default:
                    // Object or other: keep raw JSON so nothing is lost
                    return el.GetRawText();
            }
        }
    }

    /*
    USAGE EXAMPLE:

    string simple = File.ReadAllText("simple.json");
    string old = SimpleModeConverter.ConvertSimpleJsonToOldJson(simple);
    File.WriteAllText("old.json", old);

    */
}
