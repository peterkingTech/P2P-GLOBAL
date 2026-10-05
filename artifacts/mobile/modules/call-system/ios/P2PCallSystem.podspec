Pod::Spec.new do |s|
  s.name           = 'P2PCallSystem'
  s.version        = '1.0.0'
  s.summary        = 'Native phone-call integration (CallKit/PushKit) for P2P Global calls'
  s.description    = 'Local Expo module: rings P2P calls through CallKit, wakes the app with PushKit VoIP pushes, and records calls in Phone → Recents.'
  s.author         = 'P2P Global'
  s.homepage       = 'https://p2pglobal.app'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CallKit', 'PushKit', 'Intents', 'AVFoundation'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
