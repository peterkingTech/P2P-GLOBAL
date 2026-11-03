Pod::Spec.new do |s|
  s.name           = 'P2PSpeechAudio'
  s.version        = '1.0.0'
  s.summary        = 'Device-voice audio files and lock-screen track commands for P2P Global Listen'
  s.description    = 'Local Expo module: writes the device voice to temporary audio files and adds next/previous track commands.'
  s.author         = 'P2P Global'
  s.homepage       = 'https://p2pglobal.app'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'MediaPlayer'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
