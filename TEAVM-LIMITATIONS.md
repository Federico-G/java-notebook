# TeaVM Java Support Limitations

This document lists known Java APIs that don't work or have limited support in TeaVM's
WebAssembly backend. Relevant when writing notebook examples or documentation.

Reference: https://teavm.org/jcl-report/recent/jcl.html

## Not Working

### String Formatting
- `String.format()` — throws error (missing Formatter/locale support)
- `System.out.printf()` — same issue, uses Formatter internally
- `Formatter` class — not implemented
- **Workaround**: use string concatenation, `Math.round()` for decimal rounding

### I/O & Input
- `Scanner` — not available (no `System.in` in a browser)
- `java.io.File`, `FileReader`, `FileWriter` — no filesystem access
- `BufferedReader(new InputStreamReader(System.in))` — no stdin
- **Workaround**: hardcode test values or use JS interop

### Reflection
- `Class.getDeclaredConstructor()`, `Class.getDeclaredMethod()` — throws SecurityException
- `Method.invoke()` — not supported
- `Class.forName()` — limited support
- `java.lang.reflect` package — 9% fully implemented
- **Workaround**: use TeaVM's metaprogramming API (compile-time only)

### Networking
- `java.net.URL`, `HttpURLConnection` — not supported
- `java.net` package — 12% fully implemented
- **Workaround**: use TeaVM's JS interop with `fetch()`

### Serialization
- `ObjectInputStream` / `ObjectOutputStream` — not supported
- `Serializable` marker works but serialization mechanism doesn't

### Class Loading
- Custom `ClassLoader` — not supported
- `Class.getResource()` / `getResourceAsStream()` — not available

## Partially Working

### Threading
- `Thread` — emulated as green threads (coroutines), not real OS threads
- `Thread.sleep()` — works (pauses the coroutine)
- `synchronized` — compiles but is effectively single-threaded
- `java.util.concurrent` — 13% fully implemented
- `ConcurrentHashMap` — works (recent fix)
- `AtomicReference`, `AtomicInteger`, `AtomicLong` — basic support
- Most `Lock` classes — not available (`ReentrantLock` missing)

### Streams
- `java.util.stream` — 25% fully implemented
- Basic `stream()`, `filter()`, `map()`, `collect()`, `reduce()` — work
- Some collectors may be missing
- `parallelStream()` — runs sequentially (no real threads)

### Regex
- `java.util.regex` — 50% fully implemented
- `Pattern.compile()`, `Matcher` — basic patterns work
- Some advanced regex features may be missing
- Delegates to JavaScript's regex engine

### Time
- `java.time` — 63% fully implemented
- `LocalDate`, `LocalTime`, `LocalDateTime`, `Instant` — work
- `ZonedDateTime` — limited timezone detection
- `DateTimeFormatter` — mostly works, some patterns may fail

### Math
- `java.math.BigDecimal` — works for basic operations
- `java.math.BigInteger` — works for basic operations

### Locale
- Only `en_EN` locale included by default
- Other locales need explicit configuration at compile time

## Fully Working

### Core
- `java.lang.String` — all common methods (substring, charAt, indexOf, etc.)
- `java.lang.Math` — fully supported
- `java.lang.Integer`, `Long`, `Double`, etc. (boxing/unboxing)
- `java.lang.StringBuilder` / `StringBuffer`
- `java.lang.System.out.println()` — works
- `java.lang.Exception` hierarchy — works
- Generics, lambdas, method references — work

### Collections
- `java.util.ArrayList`, `LinkedList`
- `java.util.HashMap`, `TreeMap`, `LinkedHashMap`
- `java.util.HashSet`, `TreeSet`
- `java.util.Collections` utility methods
- `java.util.List.of()`, `Map.of()`, `Set.of()` (immutable factories)
- `java.util.Optional`
- `java.util.Iterator`, enhanced for-loop
- `java.util.Arrays` — sort, fill, copyOf, etc.

### Functional
- `java.util.function` — 100% implemented
- `Function`, `Consumer`, `Supplier`, `Predicate`, `BiFunction`, etc.

### Other
- `java.util.Objects`
- `java.util.Random` (partial — basic nextInt/nextDouble work)
- `java.util.zip` — jar/zip reading works (used by the compiler itself)
- Records, sealed classes, pattern matching — compile correctly
- `var` (local variable type inference) — works
