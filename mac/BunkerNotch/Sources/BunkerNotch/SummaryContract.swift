import Foundation

/// `Bunker --decode-summary file…`: decodes each companion summary and names the exact field that breaks.
/// One bad field would otherwise stop the notch from updating ("Sem conexão" with the last reading kept).
enum SummaryContract {
    static func check(_ paths: [String]) -> Int32 {
        var failed = 0
        for path in paths {
            guard let data = FileManager.default.contents(atPath: path) else { print("FALHOU \(path): não abriu"); failed += 1; continue }
            do {
                let s = try JSONDecoder().decode(Summary.self, from: data)
                print("ok \((path as NSString).lastPathComponent): fila \(s.queue.count), projetos \(s.projects.count), atividade \(s.activity.recent.count)")
            } catch let DecodingError.typeMismatch(_, c), let DecodingError.valueNotFound(_, c) {
                print("FALHOU \(path): \(c.codingPath.map(\.stringValue).joined(separator: ".")) · \(c.debugDescription)"); failed += 1
            } catch let DecodingError.keyNotFound(k, c) {
                print("FALHOU \(path): falta \((c.codingPath + [k]).map(\.stringValue).joined(separator: "."))"); failed += 1
            } catch { print("FALHOU \(path): \(error)"); failed += 1 }
        }
        return failed == 0 ? 0 : 1
    }
}
