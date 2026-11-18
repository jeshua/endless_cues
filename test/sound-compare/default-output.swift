// The system's default output device, read or set by name (CoreAudio), for the sound comparison
// (test/sound-compare/qlab.ts): nothing is installed for it.
//   swiftc -O default-output.swift -o default-output
//   default-output                       prints the default output's name, its nominal rate, and whether it has a volume
//   default-output "BlackHole 2ch"       makes that output the default (and the system's alert output)
import CoreAudio
import Foundation

func prop(_ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}
func devices() -> [AudioDeviceID] {
  var a = prop(kAudioHardwarePropertyDevices)
  var size: UInt32 = 0
  AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size)
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size, &ids)
  return ids
}
func name(_ id: AudioDeviceID) -> String {
  var a = prop(kAudioObjectPropertyName)
  var n: Unmanaged<CFString>? = nil
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(id, &a, 0, nil, &size, &n) == noErr, let s = n else { return "" }
  return s.takeRetainedValue() as String
}
func outputs(_ id: AudioDeviceID) -> Int {
  var a = prop(kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyScopeOutput)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(id, &a, 0, nil, &size) == noErr, size > 0 else { return 0 }
  let buf = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 16)
  defer { buf.deallocate() }
  guard AudioObjectGetPropertyData(id, &a, 0, nil, &size, buf) == noErr else { return 0 }
  let list = UnsafeMutableAudioBufferListPointer(buf.assumingMemoryBound(to: AudioBufferList.self))
  return list.reduce(0) { $0 + Int($1.mNumberChannels) }
}
func rate(_ id: AudioDeviceID) -> Double {
  var a = prop(kAudioDevicePropertyNominalSampleRate)
  var r: Float64 = 0
  var size = UInt32(MemoryLayout<Float64>.size)
  AudioObjectGetPropertyData(id, &a, 0, nil, &size, &r)
  return r
}
func hasVolume(_ id: AudioDeviceID) -> Bool {
  var a = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyVolumeScalar, mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
  if AudioObjectHasProperty(id, &a) { return true }
  a.mElement = 1
  return AudioObjectHasProperty(id, &a)
}
func current(_ sel: AudioObjectPropertySelector) -> AudioDeviceID {
  var a = prop(sel)
  var id: AudioDeviceID = 0
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size, &id)
  return id
}
func set(_ sel: AudioObjectPropertySelector, _ id: AudioDeviceID) -> OSStatus {
  var a = prop(sel)
  var d = id
  return AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, UInt32(MemoryLayout<AudioDeviceID>.size), &d)
}

let args = CommandLine.arguments.dropFirst()
if let want = args.first {
  guard let id = devices().first(where: { name($0) == want && outputs($0) > 0 }) else {
    FileHandle.standardError.write("no output named \(want)\n".data(using: .utf8)!)
    exit(2)
  }
  let s = set(kAudioHardwarePropertyDefaultOutputDevice, id)
  _ = set(kAudioHardwarePropertyDefaultSystemOutputDevice, id)
  if s != noErr { FileHandle.standardError.write("could not set it: \(s)\n".data(using: .utf8)!); exit(1) }
}
let d = current(kAudioHardwarePropertyDefaultOutputDevice)
print("{\"name\":\"\(name(d))\",\"rate\":\(rate(d)),\"volume\":\(hasVolume(d)),\"system\":\"\(name(current(kAudioHardwarePropertyDefaultSystemOutputDevice)))\"}")
